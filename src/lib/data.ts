// Every database read the pages make goes through here, behind Next's data cache.
// Entries are tagged "status" (and "provider:<slug>"); the poll route revalidates
// those tags only when something changed, so page traffic doesn't reach Postgres.
import { unstable_cache } from "next/cache";
import { and, asc, desc, eq, gte, inArray, isNotNull, or, isNull } from "drizzle-orm";
import { db } from "@/db";
import { categories, incidentUpdates, incidents, providerStatus, providers } from "@/db/schema";
import type { Status } from "@/lib/types";
import type { Area } from "@/lib/severity";

const SAFETY_NET_SECONDS = 600;
const DAY = 86_400_000;
// The leaderboard needs 90 days; provider pages show 12-month trends.
const RECENT_DAYS = 400;

export interface CategoryRow {
  slug: string;
  name: string;
  sortOrder: number;
}

export interface ProviderRow {
  id: number;
  slug: string;
  name: string;
  kind: string | null;
  category: string;
  sortOrder: number;
  statusPageUrl: string;
  homepageUrl: string | null;
  historyFrom: number | null;
  status: Status;
  since: number | null;
  lastCheckedAt: number | null;
  components: { name: string; status: Status; group?: string }[];
}

export interface IncidentRow {
  id: number;
  providerId: number;
  title: string;
  impact: string;
  status: string;
  startedAt: number;
  monitoringAt: number | null;
  resolvedAt: number | null;
  url: string | null;
  components: string[];
  postmortem: boolean;
  origin: string;
  tier: number | null;
  tierOverride: number | null;
  areaTiers: Partial<Record<Area, number>> | null;
  surfaces: string[] | null;
  security: boolean;
  reason: string | null;
  overrideNote: string | null;
  gradedBy: string;
  scope: string | null;
}

export interface Snapshot {
  generatedAt: number;
  categories: CategoryRow[];
  providers: ProviderRow[];
  incidents: IncidentRow[]; // last RECENT_DAYS days plus anything still open, newest first
}

const ms = (d: Date | null | undefined) => (d ? d.getTime() : null);

const incidentColumns = {
  id: incidents.id,
  providerId: incidents.providerId,
  title: incidents.title,
  impact: incidents.impact,
  status: incidents.status,
  startedAt: incidents.startedAt,
  monitoringAt: incidents.monitoringAt,
  resolvedAt: incidents.resolvedAt,
  url: incidents.url,
  components: incidents.components,
  postmortem: incidents.postmortem,
  origin: incidents.origin,
  tier: incidents.tier,
  tierOverride: incidents.tierOverride,
  areaTiers: incidents.areaTiers,
  surfaces: incidents.surfaces,
  security: incidents.security,
  reason: incidents.reason,
  overrideNote: incidents.overrideNote,
  gradedBy: incidents.gradedBy,
  scope: incidents.scope,
};

type IncidentSelect = Awaited<ReturnType<typeof selectIncidents>>[number];
const selectIncidents = () => db().select(incidentColumns).from(incidents);

function toIncidentRow(r: IncidentSelect): IncidentRow {
  return {
    ...r,
    startedAt: r.startedAt.getTime(),
    monitoringAt: ms(r.monitoringAt),
    resolvedAt: ms(r.resolvedAt),
  };
}

async function readSnapshot(): Promise<Snapshot> {
  const database = db();
  const cats = await database
    .select({ slug: categories.slug, name: categories.name, sortOrder: categories.sortOrder })
    .from(categories)
    .where(eq(categories.enabled, true))
    .orderBy(asc(categories.sortOrder));

  // Only providers whose status source has answered at least once are shown.
  const provs = await database
    .select({ p: providers, cat: categories.slug, s: providerStatus })
    .from(providers)
    .innerJoin(categories, eq(categories.id, providers.categoryId))
    .innerJoin(providerStatus, eq(providerStatus.providerId, providers.id))
    .where(and(eq(providers.enabled, true), eq(categories.enabled, true), isNotNull(providerStatus.lastOkAt)))
    .orderBy(asc(providers.sortOrder));

  const ids = provs.map((r) => r.p.id);
  const cutoff = new Date(Date.now() - RECENT_DAYS * DAY);
  const incs = ids.length
    ? await database
        .select(incidentColumns)
        .from(incidents)
        .where(and(inArray(incidents.providerId, ids), or(gte(incidents.startedAt, cutoff), isNull(incidents.resolvedAt))))
        .orderBy(desc(incidents.startedAt))
    : [];

  return {
    generatedAt: Date.now(),
    categories: cats,
    providers: provs.map(({ p, cat, s }) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      kind: p.kind,
      category: cat,
      sortOrder: p.sortOrder,
      statusPageUrl: p.statusPageUrl,
      homepageUrl: p.homepageUrl,
      historyFrom: ms(p.historyFrom),
      status: s.status,
      since: ms(s.since),
      lastCheckedAt: ms(s.lastCheckedAt),
      components: s.components ?? [],
    })),
    incidents: incs.map(toIncidentRow),
  };
}

export const getSnapshot = unstable_cache(readSnapshot, ["snapshot-v1"], {
  tags: ["status"],
  revalidate: SAFETY_NET_SECONDS,
});

export interface ProviderHistory {
  total: number;
  older: IncidentRow[]; // incidents before the recent window, newest first
  updates: Record<number, { status: string; body: string; postedAt: number }[]>; // recent incidents' updates
}

async function readProviderHistory(slug: string): Promise<ProviderHistory | null> {
  const database = db();
  const [p] = await database.select({ id: providers.id }).from(providers).where(eq(providers.slug, slug));
  if (!p) return null;
  const all = await database.select(incidentColumns).from(incidents).where(eq(incidents.providerId, p.id)).orderBy(desc(incidents.startedAt));
  const cutoff = Date.now() - RECENT_DAYS * DAY;
  const recentIds = all.filter((i) => i.startedAt.getTime() >= cutoff).map((i) => i.id);
  const ups = recentIds.length
    ? await database
        .select({ incidentId: incidentUpdates.incidentId, status: incidentUpdates.status, body: incidentUpdates.body, postedAt: incidentUpdates.postedAt })
        .from(incidentUpdates)
        .where(inArray(incidentUpdates.incidentId, recentIds))
        .orderBy(asc(incidentUpdates.postedAt))
    : [];
  const updates: ProviderHistory["updates"] = {};
  for (const u of ups) (updates[u.incidentId] ??= []).push({ status: u.status, body: u.body, postedAt: u.postedAt.getTime() });
  return {
    total: all.length,
    older: all.filter((i) => i.startedAt.getTime() < cutoff).map(toIncidentRow),
    updates,
  };
}

export function getProviderHistory(slug: string) {
  return unstable_cache(() => readProviderHistory(slug), ["provider-history-v1", slug], {
    tags: ["status", `provider:${slug}`],
    revalidate: SAFETY_NET_SECONDS,
  })();
}

/** The snapshot, or null when the database is unreachable, so pages degrade instead of crashing. */
export async function safeSnapshot(): Promise<Snapshot | null> {
  try {
    return await getSnapshot();
  } catch (err) {
    console.error("snapshot unavailable:", err);
    return null;
  }
}
