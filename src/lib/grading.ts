// Track-record math. Everyone is ranked on the same rolling window (90 days),
// whatever history we hold for them.
import { areaFor, scopeWeight, SECURITY_PENALTY, TIER_WEIGHT, type Area, type Surface } from "@/lib/severity";

export const WINDOW_DAYS = 90;
const MIN = 60_000;
const DAY = 86_400_000;
// An incident a provider forgot to close shouldn't sink them forever.
/** Sev 1 counts for up to 3 days; anything milder for 1, so a slow issue left open can't outweigh an outage. */
export const MAX_PENALTY_MINUTES = 72 * 60;
export const MAX_PENALTY_MINUTES_MILD = 24 * 60;
export const penaltyCap = (tier: number) => (tier <= 1 ? MAX_PENALTY_MINUTES : MAX_PENALTY_MINUTES_MILD);

/** Longest an incident paints day-by-day views; matches "Happening now" (LIVE_DAYS). */
export const MAX_SHOWN_DAYS = 7;

/**
 * When an incident stops showing on day-by-day views (strips, heatmap, the 7-day list):
 * at its end, or a week in. A region gone dark for months shouldn't paint the whole
 * board, the same way it can't sink the grade.
 */
export function shownEnd(i: Pick<GradeInput, "startedAt" | "resolvedAt">, now: number): number {
  return Math.min(i.resolvedAt?.getTime() ?? now, i.startedAt.getTime() + MAX_SHOWN_DAYS * DAY);
}

// A provider that leaves an incident open but posts nothing for a week has moved
// on. We end it at its last update instead of counting it as ongoing for months.
export const STALE_OPEN_DAYS = 7;

/** When an open incident should be treated as over, or null while it is still live. */
export function staleEnd(lastActivity: number, now: number): number | null {
  return now - lastActivity > STALE_OPEN_DAYS * DAY ? lastActivity : null;
}

export interface GradeInput {
  startedAt: Date;
  monitoringAt: Date | null;
  resolvedAt: Date | null;
  /** When the updates say service was back to normal; only counted once the incident is resolved. */
  recoveredAt?: Date | null;
  tier: number | null;
  tierOverride: number | null;
  areaTiers: Partial<Record<Area, number>> | null;
  surfaces: string[] | null;
  security: boolean;
  /** A real compromise or exposure: adds SECURITY_PENALTY. Plain security flags don't. */
  compromise?: boolean;
  scope?: string | null;
}

export const GRADES = [
  { grade: "A+", max: 60 },
  { grade: "A", max: 300 },
  { grade: "B", max: 900 },
  { grade: "C", max: 2400 },
  { grade: "D", max: 6000 },
  { grade: "F", max: Infinity },
] as const;
export type Grade = (typeof GRADES)[number]["grade"];

export function gradeFor(points: number): Grade {
  return GRADES.find((g) => points <= g.max)!.grade;
}

/** 0 for A+, up to 5 for F. */
export function gradeRank(grade: Grade): number {
  return GRADES.findIndex((g) => g.grade === grade);
}

export function effectiveTier(i: Pick<GradeInput, "tier" | "tierOverride">): number {
  return i.tierOverride ?? i.tier ?? 4;
}

/** Minutes the incident ran, start to resolve (or now). Used for display and uptime. */
export function durationMinutes(i: Pick<GradeInput, "startedAt" | "resolvedAt">, now = new Date()): number {
  return Math.max(0, ((i.resolvedAt ?? now).getTime() - i.startedAt.getTime()) / MIN);
}

/**
 * Penalty minutes run from the start until the provider first says "monitoring"
 * (or resolves), clipped to the window, so pages left open for a day of monitoring
 * aren't over-punished. Once it's resolved, they stop earlier if the updates say
 * service was back to normal while the page stayed open (recoveredAt).
 */
export function penaltyEnd(i: Pick<GradeInput, "startedAt" | "monitoringAt" | "resolvedAt" | "recoveredAt">): Date | null {
  const end = i.monitoringAt ?? i.resolvedAt;
  const r = i.recoveredAt;
  if (!end || !i.resolvedAt || !r || r < i.startedAt || r >= end) return end;
  return r;
}

export function penaltyMinutes(i: GradeInput, from: Date, to: Date): number {
  const end = penaltyEnd(i) ?? to;
  const s = Math.max(i.startedAt.getTime(), from.getTime());
  const e = Math.min(end.getTime(), to.getTime(), i.startedAt.getTime() + penaltyCap(effectiveTier(i)) * MIN);
  return Math.max(0, (e - s) / MIN);
}

/** Follow-ups to a breach (key revocations, clarifications) posted within this many days are the same breach. */
export const BREACH_FOLLOW_UP_DAYS = 7;

/**
 * One breach, one security penalty: a provider's compromise incidents that start within
 * BREACH_FOLLOW_UP_DAYS of an earlier one keep their SECURITY pill but lose the 600 points.
 */
export function onePenaltyPerBreach<T extends { providerId: number; startedAt: number; compromise?: boolean }>(rows: T[]): T[] {
  const last = new Map<number, number>();
  const firsts = new Set<T>();
  for (const r of [...rows].filter((r) => r.compromise).sort((a, b) => a.startedAt - b.startedAt)) {
    const prev = last.get(r.providerId);
    if (prev == null || r.startedAt - prev > BREACH_FOLLOW_UP_DAYS * DAY) firsts.add(r);
    last.set(r.providerId, r.startedAt);
  }
  return rows.map((r) => (r.compromise && !firsts.has(r) ? { ...r, compromise: false } : r));
}

export function incidentPoints(i: GradeInput, from: Date, to: Date): number {
  const tier = effectiveTier(i);
  let pts = TIER_WEIGHT[tier] * scopeWeight(i.scope) * penaltyMinutes(i, from, to);
  if (i.compromise && i.startedAt >= from) pts += SECURITY_PENALTY;
  return pts;
}

function areaTiersOf(i: GradeInput): Partial<Record<Area, number>> {
  if (i.tierOverride != null) {
    // A manual override applies to every area the incident touched.
    const out: Partial<Record<Area, number>> = {};
    for (const s of i.surfaces ?? []) {
      const area = areaFor(s as Surface, i.tierOverride);
      if (area) out[area] = i.tierOverride;
    }
    if (Object.keys(out).length === 0 && i.tierOverride > 0 && i.tierOverride <= 3) out.production = i.tierOverride;
    return out;
  }
  return i.areaTiers ?? {};
}

/** Union of [start, end) intervals in minutes, clipped to the window. */
export function unionMinutes(intervals: [number, number][], from: number, to: number): number {
  const clipped = intervals
    .map(([s, e]) => [Math.max(s, from), Math.min(e, to)] as [number, number])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const iv of clipped) {
    if (!cur || iv[0] > cur[1]) {
      if (cur) total += cur[1] - cur[0];
      cur = [...iv];
    } else cur[1] = Math.max(cur[1], iv[1]);
  }
  if (cur) total += cur[1] - cur[0];
  return total / MIN;
}

/**
 * How hard an incident hit the customers it reached, for uptime: down counts in full,
 * degraded counts half. Can't-ship and papercuts don't stop a running app; SHIP grades those.
 */
export const UPTIME_DEPTH: Record<number, number> = { 1: 1, 2: 0.5 };

/**
 * Customer-minutes hit: each moment counts the worst incident running, weighted by how
 * hard (UPTIME_DEPTH) and how many (scope), so overlapping posts about one outage count once.
 * Runs to recovery when the updates say so, and at most MAX_SHOWN_DAYS: a region written
 * off for months is history, as on the heatmap.
 */
export function hitMinutes(incidents: GradeInput[], from: Date, to: Date): number {
  const f = from.getTime();
  const t = to.getTime();
  const spans: [number, number, number][] = [];
  for (const i of incidents) {
    const w = (UPTIME_DEPTH[effectiveTier(i)] ?? 0) * scopeWeight(i.scope);
    if (!w) continue;
    const s = i.startedAt.getTime();
    const r = i.recoveredAt?.getTime();
    const resolved = i.resolvedAt?.getTime();
    const end = resolved != null && r != null && r > s && r < resolved ? r : (resolved ?? t);
    const e = Math.min(end, s + MAX_SHOWN_DAYS * DAY, t);
    if (e > Math.max(s, f)) spans.push([Math.max(s, f), e, w]);
  }
  const edges = [...new Set(spans.flatMap(([s, e]) => [s, e]))].sort((a, b) => a - b);
  let total = 0;
  for (let k = 0; k + 1 < edges.length; k++) {
    const [a, b] = [edges[k], edges[k + 1]];
    let w = 0;
    for (const [s, e, x] of spans) if (s <= a && e >= b && x > w) w = x;
    total += w * (b - a);
  }
  return total / MIN;
}

export interface AreaScore {
  points: number;
  grade: Grade;
  incidents: number;
  downtimeMinutes: number;
}

export interface Score {
  points: number;
  grade: Grade;
  areas: Record<Area, AreaScore>;
  /** Share of customer time in the window not hit, by the provider's own account (hitMinutes). */
  admittedUptime: number;
  /** "Fully down": widespread Sev 1 time, unweighted. */
  sev1Minutes: number;
  incidentCount: number;
  sevCounts: [number, number, number, number]; // Sev 1..4
  /** Longest Sev 1-2 incident in the window, start to resolved. 0 if none. */
  longestMinutes: number;
  medianResolveMinutes: number | null;
  securityCount: number;
}

export function windowBounds(now = new Date(), days = WINDOW_DAYS): { from: Date; to: Date } {
  return { from: new Date(now.getTime() - days * DAY), to: now };
}

export function score(incidents: GradeInput[], from: Date, to: Date): Score {
  const inWindow = incidents.filter((i) => i.startedAt < to && (i.resolvedAt ?? to) > from);
  const counted = inWindow.filter((i) => effectiveTier(i) > 0);

  let points = 0;
  const areas: Record<Area, AreaScore> = {
    production: { points: 0, grade: "A+", incidents: 0, downtimeMinutes: 0 },
    shipping: { points: 0, grade: "A+", incidents: 0, downtimeMinutes: 0 },
  };
  const areaIntervals: Record<Area, [number, number][]> = { production: [], shipping: [] };
  const sev1: [number, number][] = [];
  const sevCounts: [number, number, number, number] = [0, 0, 0, 0];
  let longest = 0;
  let securityCount = 0;
  const resolveTimes: number[] = [];

  for (const i of counted) {
    const tier = effectiveTier(i);
    points += incidentPoints(i, from, to);
    sevCounts[tier - 1]++;
    if (i.security) securityCount++;
    const end = (i.resolvedAt ?? to).getTime();
    // Uptime is provider-wide: a Sev 1 in one region or for one add-on doesn't take it down.
    if (tier === 1 && scopeWeight(i.scope) === 1) sev1.push([i.startedAt.getTime(), end]);
    // Longest is downtime: a Sev 3-4 left open for weeks is a papercut, not a record.
    // Only incidents that began in the window: a region written off months ago is history.
    if (tier <= 2 && i.startedAt >= from) longest = Math.max(longest, durationMinutes(i, to));
    if (i.resolvedAt) resolveTimes.push(durationMinutes(i));

    const minutes = penaltyMinutes(i, from, to) * scopeWeight(i.scope);
    for (const [area, t] of Object.entries(areaTiersOf(i)) as [Area, number][]) {
      // A "dashboard" key graded before there were two areas, or a papercut stored before
      // CLASSIFIER_VERSION 9: papercuts count overall only.
      if (!t || t >= 4 || !areas[area]) continue;
      areas[area].points += TIER_WEIGHT[t] * minutes;
      areas[area].incidents++;
      areaIntervals[area].push([i.startedAt.getTime(), end]);
    }
  }

  const f = from.getTime();
  const t = to.getTime();
  for (const a of Object.keys(areas) as Area[]) {
    areas[a].grade = gradeFor(areas[a].points);
    areas[a].downtimeMinutes = unionMinutes(areaIntervals[a], f, t);
  }
  const sev1Minutes = unionMinutes(sev1, f, t);
  const windowMinutes = (t - f) / MIN;
  resolveTimes.sort((a, b) => a - b);

  return {
    points: Math.round(points),
    grade: gradeFor(points),
    areas,
    admittedUptime: windowMinutes > 0 ? 1 - hitMinutes(counted, from, to) / windowMinutes : 1,
    sev1Minutes,
    incidentCount: counted.length,
    sevCounts,
    longestMinutes: longest,
    medianResolveMinutes: resolveTimes.length ? resolveTimes[Math.floor(resolveTimes.length / 2)] : null,
    securityCount,
  };
}
