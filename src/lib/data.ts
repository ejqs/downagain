// Every database read the pages make goes through here, behind Next's data cache.
// Entries are tagged "status" (and "provider:<slug>"); the poll route revalidates
// those tags only when something changed, so page traffic doesn't reach Postgres.
import { unstable_cache } from "next/cache";
import { and, asc, desc, eq, gte, inArray, isNotNull, or, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, incidentReviews, incidentUpdates, incidents, providerStatus, providers, statusChanges } from "@/db/schema";
import type { Status } from "@/lib/types";
import type { Area } from "@/lib/severity";
import { httpUrl } from "@/lib/format";
import { onePenaltyPerBreach, staleEnd } from "@/lib/grading";
import { dropBareTwins } from "@/lib/status";

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
  /** First poll. With historyFrom, where the data we hold starts (see coveredDays). */
  trackedFrom?: number | null;
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
  /** Claude's read of when service was back, see penaltyEnd. */
  recoveredAt?: number | null;
  url: string | null;
  components: string[];
  /** Cloud regions the provider named; null or empty when global or not stated. */
  regions?: string[] | null;
  postmortem: boolean;
  origin: string;
  tier: number | null;
  tierOverride: number | null;
  areaTiers: Partial<Record<Area, number>> | null;
  surfaces: string[] | null;
  security: boolean;
  compromise?: boolean;
  reason: string | null;
  overrideNote: string | null;
  gradedBy: string;
  scope: string | null;
  summary: string | null;
  /** Claude's read: the earlier incident this one continues (see timelines.ts). */
  follows?: number | null;
  /** Left open by the provider with no update for a week; resolvedAt is then its last update. */
  stale: boolean;
}

export interface Snapshot {
  generatedAt: number;
  categories: CategoryRow[];
  providers: ProviderRow[];
  incidents: IncidentRow[]; // last RECENT_DAYS days plus anything still open, newest first
  /** Set when the view is narrowed to what someone uses (see applyFilter): the areas that matter to them. */
  focus?: { areas: Area[] };
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
  recoveredAt: incidents.recoveredAt,
  url: incidents.url,
  components: incidents.components,
  regions: incidents.regions,
  postmortem: incidents.postmortem,
  origin: incidents.origin,
  tier: incidents.tier,
  tierOverride: incidents.tierOverride,
  areaTiers: incidents.areaTiers,
  surfaces: incidents.surfaces,
  security: incidents.security,
  compromise: incidents.compromise,
  reason: incidents.reason,
  overrideNote: incidents.overrideNote,
  gradedBy: incidents.gradedBy,
  scope: incidents.scope,
  summary: incidents.summary,
  follows: incidents.follows,
  sourceUpdatedAt: incidents.sourceUpdatedAt,
  lastUpdateAt: sql<Date | string | null>`(select max(${incidentUpdates.postedAt}) from ${incidentUpdates} where ${incidentUpdates.incidentId} = ${incidents.id})`,
};

type IncidentSelect = Awaited<ReturnType<typeof selectIncidents>>[number];
const selectIncidents = () => db().select(incidentColumns).from(incidents);

export function toIncidentRow(r: IncidentSelect, now = Date.now()): IncidentRow {
  const { sourceUpdatedAt, lastUpdateAt, ...rest } = r;
  const startedAt = r.startedAt.getTime();
  const lastActivity = Math.max(startedAt, ms(r.monitoringAt) ?? 0, ms(sourceUpdatedAt) ?? 0, lastUpdateAt ? new Date(lastUpdateAt).getTime() : 0);
  const end = r.resolvedAt ? null : staleEnd(lastActivity, now);
  return {
    ...rest,
    url: httpUrl(r.url),
    // Some status pages list a component once per group it sits in, or bare and grouped.
    components: dropBareTwins(r.components ?? []),
    startedAt,
    monitoringAt: ms(r.monitoringAt),
    resolvedAt: ms(r.resolvedAt) ?? end,
    recoveredAt: ms(r.recoveredAt),
    stale: end != null,
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

  const firstPolls = ids.length
    ? await database
        .select({ providerId: statusChanges.providerId, at: sql<Date | string>`min(${statusChanges.changedAt})` })
        .from(statusChanges)
        .where(inArray(statusChanges.providerId, ids))
        .groupBy(statusChanges.providerId)
    : [];
  const trackedFrom = new Map(firstPolls.map((r) => [r.providerId, new Date(r.at).getTime()]));

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
      trackedFrom: trackedFrom.get(p.id) ?? null,
      status: s.status,
      since: ms(s.since),
      lastCheckedAt: ms(s.lastCheckedAt),
      components: s.components ?? [],
    })),
    incidents: onePenaltyPerBreach(incs.map((r) => toIncidentRow(r))),
  };
}

export const getSnapshot = unstable_cache(readSnapshot, ["snapshot-v2"], {
  tags: ["status"],
  revalidate: SAFETY_NET_SECONDS,
});

export interface ProviderHistory {
  total: number;
  older: IncidentRow[]; // incidents before the recent window, newest first
  updates: Record<number, { status: string; body: string; postedAt: number }[]>; // recent incidents' updates
  reviews: Record<number, ReviewTrace>; // Claude's read behind each AI-graded incident
}

/** What a reader needs to check an AI grade: who graded it, when, against what the rules said. */
export interface ReviewTrace {
  model: string;
  promptVersion: number;
  reviewedAt: number;
  rulesTier: number | null;
  rulesReason: string | null;
  tier: number | null;
  verdict: unknown;
}

/** The review whose verdict an incident currently shows, with what Claude read and answered. */
export async function readReview(incidentId: number) {
  const [r] = await db()
    .select({ review: incidentReviews, title: incidents.title, provider: providers.slug, gradedBy: incidents.gradedBy })
    .from(incidents)
    .innerJoin(providers, eq(providers.id, incidents.providerId))
    .innerJoin(incidentReviews, and(eq(incidentReviews.incidentId, incidents.id), eq(incidentReviews.inputHash, incidents.reviewedHash)))
    .where(eq(incidents.id, incidentId));
  return r ?? null;
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
  const aiIds = all.filter((i) => i.gradedBy === "claude").map((i) => i.id);
  const revs = aiIds.length
    ? await database
        .select({
          incidentId: incidentReviews.incidentId,
          model: incidentReviews.model,
          promptVersion: incidentReviews.promptVersion,
          createdAt: incidentReviews.createdAt,
          rulesTier: incidentReviews.rulesTier,
          rulesReason: incidentReviews.rulesReason,
          tier: incidentReviews.tier,
          verdict: incidentReviews.verdict,
        })
        .from(incidentReviews)
        .innerJoin(incidents, and(eq(incidents.id, incidentReviews.incidentId), eq(incidents.reviewedHash, incidentReviews.inputHash)))
        .where(inArray(incidentReviews.incidentId, aiIds))
    : [];
  const reviews: ProviderHistory["reviews"] = {};
  for (const { createdAt, incidentId, ...r } of revs) reviews[incidentId] = { ...r, reviewedAt: createdAt.getTime() };
  return {
    total: all.length,
    reviews,
    older: onePenaltyPerBreach(all.filter((i) => i.startedAt.getTime() < cutoff).map((r) => toIncidentRow(r))),
    updates,
  };
}

export function getProviderHistory(slug: string) {
  return unstable_cache(() => readProviderHistory(slug), ["provider-history-v2", slug], {
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
