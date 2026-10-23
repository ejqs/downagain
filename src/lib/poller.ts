// One poll: read every enabled provider's status source, write only what
// changed, and report which providers changed so the caller can revalidate.
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { categories, componentSurfaces, incidentUpdates, incidents, providerStatus, providers, rawSnapshots, statusChanges } from "@/db/schema";
import { readProvider } from "@/lib/adapters";
import { makeGetter } from "@/lib/fetcher";
import { httpUrl } from "@/lib/format";
import { classify, type Surface } from "@/lib/severity";
import type { NormalizedComponent, NormalizedIncident, Status } from "@/lib/types";

// A status page that stops answering is "unknown", not "down", and only after
// it has been unreachable for a while, so one slow response doesn't flap.
const UNKNOWN_AFTER_MS = 15 * 60_000;
const CONCURRENCY = 4;

export interface ProviderPollResult {
  slug: string;
  ok: boolean;
  changed: boolean;
  status: Status;
  newIncidents: number;
  updatedIncidents: number;
  error?: string;
}

const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);

function stateHash(status: Status, components: NormalizedComponent[], incs: NormalizedIncident[] | undefined, prevIncidentKey: string | null) {
  const incidentKey = incs
    ? sha(incs.map((i) => [i.externalId, i.status, i.resolvedAt?.toISOString() ?? null, i.updates.length, ...(i.regions?.length ? [i.regions] : [])]))
    : prevIncidentKey;
  return { hash: `${sha([status, components])}:${incidentKey ?? ""}`, incidentKey };
}

function withoutVolatile(raw: Record<string, unknown> | undefined) {
  const summary = raw?.summary as { page?: Record<string, unknown> } | undefined;
  if (!summary) return raw?.status ?? null;
  const { page, ...rest } = summary;
  return { ...rest, page: page ? { ...page, updated_at: undefined } : undefined };
}

async function pollProvider(database: DB, p: typeof providers.$inferSelect, categorySlug: string, now: Date, origin?: "backfill" | "live"): Promise<ProviderPollResult> {
  const [prev] = await database.select().from(providerStatus).where(eq(providerStatus.providerId, p.id));
  const etags = { ...(prev?.etags ?? {}) };
  const base = { slug: p.slug, newIncidents: 0, updatedIncidents: 0 };

  let snap;
  try {
    snap = await readProvider(p, makeGetter(etags));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const lastOk = prev?.lastOkAt?.getTime() ?? 0;
    const goUnknown = !prev || now.getTime() - lastOk > UNKNOWN_AFTER_MS;
    const status: Status = goUnknown ? "unknown" : prev.status;
    const changed = !prev || status !== prev.status;
    await database
      .insert(providerStatus)
      .values({ providerId: p.id, status, since: now, lastCheckedAt: now, fetchError: message, etags })
      .onConflictDoUpdate({
        target: providerStatus.providerId,
        set: { status, lastCheckedAt: now, fetchError: message, ...(changed ? { since: now } : {}) },
      });
    if (changed && prev) await database.insert(statusChanges).values({ providerId: p.id, status, changedAt: now });
    return { ...base, ok: false, changed: changed && Boolean(prev?.lastOkAt), status, error: message };
  }

  const status: Status = snap.status ?? prev?.status ?? "unknown";
  const components = snap.components ?? prev?.components ?? [];
  const prevIncidentKey = prev?.stateHash?.split(":")[1] || null;
  const { hash } = stateHash(status, components, snap.incidents, prevIncidentKey);
  const firstPoll = !prev?.lastOkAt;
  const changed = !prev || prev.stateHash !== hash;
  const statusChanged = !prev || prev.status !== status;

  let newIncidents = 0;
  let updatedIncidents = 0;
  if (snap.incidents && changed) {
    const r = await writeIncidents(database, p, categorySlug, snap.incidents, origin ?? (firstPoll ? "backfill" : "live"), now);
    newIncidents = r.inserted;
    updatedIncidents = r.updated;
  }

  if (changed && snap.raw) {
    const body = withoutVolatile(snap.raw);
    if (body) {
      const h = sha(body);
      const [last] = await database
        .select({ hash: rawSnapshots.hash })
        .from(rawSnapshots)
        .where(eq(rawSnapshots.providerId, p.id))
        .orderBy(desc(rawSnapshots.fetchedAt))
        .limit(1);
      if (last?.hash !== h) await database.insert(rawSnapshots).values({ providerId: p.id, hash: h, body, fetchedAt: now });
    }
  }

  await database
    .insert(providerStatus)
    .values({ providerId: p.id, status, since: now, lastCheckedAt: now, lastOkAt: now, fetchError: null, stateHash: hash, etags, components })
    .onConflictDoUpdate({
      target: providerStatus.providerId,
      set: {
        status,
        lastCheckedAt: now,
        lastOkAt: now,
        fetchError: null,
        stateHash: hash,
        etags,
        components,
        ...(statusChanged ? { since: now } : {}),
      },
    });
  if (statusChanged) await database.insert(statusChanges).values({ providerId: p.id, status, changedAt: now });

  // A provider whose status page just came back after being "unknown" counts as changed too:
  // its stored hash still matches, but the pages are showing "unknown".
  return { ...base, ok: true, changed: changed || statusChanged || firstPoll, status, newIncidents, updatedIncidents };
}

export async function writeIncidents(
  database: DB,
  p: typeof providers.$inferSelect,
  categorySlug: string,
  list: NormalizedIncident[],
  origin: "backfill" | "live",
  now: Date,
  opts: { closeVanished?: boolean } = {},
): Promise<{ inserted: number; updated: number }> {
  const overrides = new Map<string, Surface>(
    (await database.select().from(componentSurfaces).where(eq(componentSurfaces.providerId, p.id))).map((r) => [r.componentName, r.surface as Surface]),
  );
  const existing = new Map(
    (
      await database
        .select({ id: incidents.id, externalId: incidents.externalId, status: incidents.status, resolvedAt: incidents.resolvedAt, sourceUpdatedAt: incidents.sourceUpdatedAt, regions: incidents.regions })
        .from(incidents)
        .where(eq(incidents.providerId, p.id))
    ).map((r) => [r.externalId, r]),
  );

  let inserted = 0;
  let updated = 0;
  for (const inc of list) {
    const ex = existing.get(inc.externalId);
    const same =
      ex &&
      ex.status === inc.status &&
      (ex.resolvedAt?.getTime() ?? null) === (inc.resolvedAt?.getTime() ?? null) &&
      (ex.sourceUpdatedAt?.getTime() ?? null) === (inc.sourceUpdatedAt?.getTime() ?? null) &&
      // An adapter fix can change what regions we read without the provider touching the incident.
      (ex.regions ?? []).join() === (inc.regions ?? []).join();
    if (same) continue;

    const c = classify(
      {
        title: inc.title,
        impact: inc.impact,
        components: inc.components,
        worstComponentStatus: inc.worstComponentStatus,
        regions: inc.regions,
        updateText: inc.updates.map((u) => u.body).join("\n"),
        categorySlug,
      },
      overrides,
    );
    const values = {
      providerId: p.id,
      externalId: inc.externalId,
      title: inc.title,
      impact: inc.impact,
      status: inc.status,
      startedAt: inc.startedAt,
      monitoringAt: inc.monitoringAt,
      resolvedAt: inc.resolvedAt,
      url: httpUrl(inc.url),
      components: inc.components,
      regions: inc.regions?.length ? inc.regions : null,
      worstComponentStatus: inc.worstComponentStatus,
      postmortem: inc.postmortem,
      raw: inc.raw,
      tier: c.tier,
      areaTiers: c.areaTiers,
      surfaces: c.surfaces,
      security: c.security,
      lowConfidence: c.lowConfidence,
      reason: c.reason,
      classifierVersion: c.classifierVersion,
      // The rules grade goes in first; reviewPending refines it with Claude afterwards.
      gradedBy: "rules",
      scope: c.scope ?? null,
      summary: null,
      sourceUpdatedAt: inc.sourceUpdatedAt,
      updatedAt: now,
    };
    const [row] = await database
      .insert(incidents)
      .values({ ...values, origin, firstSeenAt: now })
      // origin, firstSeenAt and any manual tierOverride are kept on update.
      .onConflictDoUpdate({ target: [incidents.providerId, incidents.externalId], set: values })
      .returning({ id: incidents.id });
    if (ex) updated++;
    else inserted++;

    if (inc.updates.length) {
      await database
        .insert(incidentUpdates)
        .values(inc.updates.map((u) => ({ incidentId: row.id, externalId: u.externalId, status: u.status, body: u.body, postedAt: u.postedAt })))
        .onConflictDoNothing();
    }
  }

  // Feeds like Railway's only list current incidents. One that was open in our
  // records and is no longer listed has ended; we close it at the time we noticed.
  const seen = new Set(list.map((i) => i.externalId));
  // An archive import is a partial list, so it never closes anything.
  const vanished = opts.closeVanished === false ? [] : [...existing.values()].filter((r) => !r.resolvedAt && !seen.has(r.externalId)).map((r) => r.id);
  if (vanished.length) {
    await database
      .update(incidents)
      .set({ resolvedAt: now, status: "resolved", updatedAt: now })
      .where(and(inArray(incidents.id, vanished), isNull(incidents.resolvedAt)));
    updated += vanished.length;
  }

  if (list.length) {
    const oldest = list.reduce((m, i) => (i.startedAt < m ? i.startedAt : m), list[0].startedAt);
    if (!p.historyFrom || oldest < p.historyFrom) {
      await database.update(providers).set({ historyFrom: oldest }).where(eq(providers.id, p.id));
    }
  }
  return { inserted, updated };
}

let running = false;

export async function pollAll(database: DB, opts: { slugs?: string[]; origin?: "backfill" | "live"; now?: Date } = {}): Promise<ProviderPollResult[]> {
  if (running) throw new Error("A poll is already running");
  running = true;
  try {
    const now = opts.now ?? new Date();
    const rows = await database
      .select({ p: providers, categorySlug: categories.slug })
      .from(providers)
      .innerJoin(categories, eq(categories.id, providers.categoryId))
      .where(eq(providers.enabled, true));
    const todo = opts.slugs?.length ? rows.filter((r) => opts.slugs!.includes(r.p.slug)) : rows;

    const results: ProviderPollResult[] = [];
    for (let i = 0; i < todo.length; i += CONCURRENCY) {
      const batch = todo.slice(i, i + CONCURRENCY);
      results.push(...(await Promise.all(batch.map((r) => pollProvider(database, r.p, r.categorySlug, now, opts.origin)))));
    }
    return results;
  } finally {
    running = false;
  }
}
