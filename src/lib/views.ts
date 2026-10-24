// Pure functions that turn the cached snapshot into what each page shows.
import { durationMinutes, effectiveTier, gradeFor, gradeRank, incidentPoints, MAX_SHOWN_DAYS, penaltyMinutes, score, shownEnd, windowBounds, type GradeInput, type Score } from "@/lib/grading";
import { AREAS, SECURITY_PENALTY, TIER_WEIGHT, scopeWeight, type Area } from "@/lib/severity";
import { PRICES, monthlyUsd, valueFrontier, type Price } from "@/lib/pricing";
import type { IncidentRow, ProviderRow, Snapshot } from "@/lib/data";
import { isLocation, isProblem, statusRank } from "@/lib/status";
import type { Status } from "@/lib/types";

const DAY = 86_400_000;

export function gradeInput(i: IncidentRow): GradeInput {
  return {
    startedAt: new Date(i.startedAt),
    monitoringAt: i.monitoringAt ? new Date(i.monitoringAt) : null,
    resolvedAt: i.resolvedAt ? new Date(i.resolvedAt) : null,
    recoveredAt: i.recoveredAt ? new Date(i.recoveredAt) : null,
    tier: i.tier,
    tierOverride: i.tierOverride,
    areaTiers: i.areaTiers,
    surfaces: i.surfaces,
    security: i.security,
    compromise: i.compromise,
    scope: i.scope,
  };
}

export const tierOf = (i: IncidentRow) => effectiveTier(i);

/** Below this many days of data a provider gets no grade: an empty feed isn't an A+. */
export const MIN_GRADED_DAYS = 14;

/**
 * Days of the window our data covers: from the older of the first poll and the oldest
 * incident we hold. Feeds that only list open incidents (Azure) or the last 25 to 50
 * (busy Statuspage and incident.io pages) start short of 90 and fill in as we poll.
 */
export function coveredDays(p: Pick<ProviderRow, "historyFrom" | "trackedFrom">, now: number, days = 90): number {
  const from = dataFrom(p);
  // Never polled is never shown, so null only means we can't tell: assume the full window.
  return from == null ? days : Math.max(0, Math.min(days, Math.floor((now - from) / DAY)));
}

/** Where the data we hold for a provider starts, or null if we know nothing yet. */
export function dataFrom(p: Pick<ProviderRow, "historyFrom" | "trackedFrom">): number | null {
  const starts = [p.historyFrom, p.trackedFrom].filter((t): t is number => t != null);
  return starts.length ? Math.min(...starts) : null;
}

export function isGraded(p: Pick<ProviderRow, "historyFrom" | "trackedFrom">, now: number): boolean {
  return coveredDays(p, now) >= MIN_GRADED_DAYS;
}

export function incidentsFor(snap: Snapshot, providerId: number): IncidentRow[] {
  return snap.incidents.filter((i) => i.providerId === providerId);
}

export function scoreFor(snap: Snapshot, providerId: number, days = 90, now = snap.generatedAt): Score {
  const { from, to } = windowBounds(new Date(now), days);
  const s = score(incidentsFor(snap, providerId).map(gradeInput), from, to);
  return snap.focus ? focusScore(s, snap.focus.areas) : s;
}

/**
 * In a narrowed view the overall grade is what the areas that matter add up to:
 * someone who only runs a database doesn't care that deploys were down.
 */
export function focusScore(s: Score, areas: Area[]): Score {
  if (areas.length === AREAS.length) return s;
  const points = Math.round(areas.reduce((t, a) => t + s.areas[a].points, 0));
  return { ...s, points, grade: gradeFor(points) };
}

export type DayCell = "up" | "minor" | "major" | "none";

/** One cell per day, oldest first: the worst counted tier that touched that UTC day. */
export function dailyCells(list: IncidentRow[], days: number, now: number, since?: number | null): DayCell[] {
  const today = Math.floor(now / DAY) * DAY;
  const cells: DayCell[] = [];
  for (let d = days - 1; d >= 0; d--) {
    const start = today - d * DAY;
    const end = start + DAY;
    if (since && end < since) {
      cells.push("none");
      continue;
    }
    let worst = 5;
    for (const i of list) {
      const t = tierOf(i);
      if (t === 0) continue;
      if (i.startedAt < end && shownEnd(gradeInput(i), now) >= start) worst = Math.min(worst, t);
    }
    cells.push(worst <= 2 ? "major" : worst <= 4 ? "minor" : "up");
  }
  return cells;
}

export interface DayLoad {
  day: number; // UTC midnight
  points: number; // severity weight x penalty minutes inside the day, same scale as grades
  incidents: number;
  worst: number; // best (lowest) tier that touched the day, 5 when none
  top: IncidentRow | null; // the day's worst incident: lowest tier, then longest
}

/** Trouble per UTC day across every incident given, oldest first. */
export function dailyLoad(list: IncidentRow[], days: number, now: number): DayLoad[] {
  const today = Math.floor(now / DAY) * DAY;
  const long = (i: IncidentRow) => shownEnd(gradeInput(i), now) - i.startedAt;
  const out: DayLoad[] = [];
  for (let d = days - 1; d >= 0; d--) {
    const start = today - d * DAY;
    const end = Math.min(start + DAY, now);
    const cell: DayLoad = { day: start, points: 0, incidents: 0, worst: 5, top: null };
    for (const i of list) {
      const t = tierOf(i);
      if (t === 0 || i.startedAt >= start + DAY || shownEnd(gradeInput(i), now) < start) continue;
      cell.incidents++;
      if (t < cell.worst || (t === cell.worst && cell.top && long(i) > long(cell.top))) cell.top = i;
      cell.worst = Math.min(cell.worst, t);
      cell.points += TIER_WEIGHT[t] * penaltyMinutes(gradeInput(i), new Date(start), new Date(end));
      if (i.compromise && i.startedAt >= start) cell.points += SECURITY_PENALTY;
    }
    cell.points = Math.round(cell.points);
    out.push(cell);
  }
  return out;
}

/** Calendar colour step for a day's worst tier: 0 clean, 1 Sev 3–4, 2 Sev 2, 3 Sev 1. */
export function heatLevel(worst: number): 0 | 1 | 2 | 3 {
  return worst <= 1 ? 3 : worst === 2 ? 2 : worst <= 4 ? 1 : 0;
}

export function openIncidents(list: IncidentRow[]): IncidentRow[] {
  return list.filter((i) => !i.resolvedAt && tierOf(i) > 0);
}

/**
 * Open incidents that started within the last week. Anything older that is still
 * open (a region written off for months, a page nobody closed) is history, not news,
 * so it stays out of "Happening now".
 */
/** Where it hit, for one-line lists: the regions when the provider named them, else the first components. */
export function whereHit(i: Pick<IncidentRow, "regions" | "components">, n = 3): string {
  const list = i.regions?.length ? i.regions : i.components;
  return list.length > n ? `${list.slice(0, n).join(", ")} +${list.length - n}` : list.join(", ");
}

export const LIVE_DAYS = MAX_SHOWN_DAYS;
export function liveIncidents(list: IncidentRow[], now: number): IncidentRow[] {
  return openIncidents(list).filter((i) => i.startedAt >= now - LIVE_DAYS * 86_400_000);
}

export interface DownItem {
  provider: ProviderRow;
  title: string;
  tier: number | null;
  sinceMs: number;
  status: Status;
  /** Every open incident says the fix is in and the provider is watching it. */
  monitoring: boolean;
}

const STATUS_TIER: Partial<Record<Status, number>> = { major_outage: 1, partial_outage: 2, degraded: 2 };

/**
 * "down" is Sev 1 or a major outage; anything milder in the banner is "issues".
 * Once the provider says it's monitoring a fix, it's "monitoring", whatever the tier.
 */
export type LiveLevel = "down" | "issues" | "monitoring";
export const LIVE_LABEL: Record<LiveLevel, string> = { down: "DOWN", issues: "ISSUES", monitoring: "MONITORING" };

export function liveLevel(d: Pick<DownItem, "tier" | "status"> & { monitoring?: boolean }): LiveLevel {
  if (d.monitoring) return "monitoring";
  return d.tier === 1 || d.status === "major_outage" ? "down" : "issues";
}

/** The level that colours a group of live items: down beats issues beats monitoring. */
export function worstLevel(items: Parameters<typeof liveLevel>[0][]): LiveLevel | null {
  const levels = items.map(liveLevel);
  return levels.includes("down") ? "down" : levels.includes("issues") ? "issues" : levels.length ? "monitoring" : null;
}

/** "2 down · 1 issue · 1 monitoring"-style count for a set of providers, or null when all are up. */
export function liveCount(items: DownItem[]): string | null {
  const n = (l: LiveLevel) => items.filter((d) => liveLevel(d) === l).length;
  const [down, issues, monitoring] = [n("down"), n("issues"), n("monitoring")];
  const parts = [down ? `${down} down` : null, issues ? `${issues} ${issues === 1 ? "issue" : "issues"}` : null, monitoring ? `${monitoring} monitoring` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** The provider has posted "monitoring" and nothing since says otherwise. */
export const isMonitoring = (i: Pick<IncidentRow, "status">) => i.status === "monitoring";

/**
 * Providers reporting a problem right now: an open Sev 1–3 incident, or a
 * non-green status with no incident posted. An open Sev 4 alone doesn't count.
 */
export function downNow(snap: Snapshot): DownItem[] {
  const out: DownItem[] = [];
  for (const p of snap.providers) {
    const mine = incidentsFor(snap, p.id);
    const open = liveIncidents(mine, snap.generatedAt).sort((a, b) => tierOf(a) - tierOf(b) || a.startedAt - b.startedAt);
    if (open.length) {
      const worst = open[0];
      if (tierOf(worst) > 3) continue;
      out.push({
        provider: p,
        title: open.length > 1 ? `${worst.title} (+${open.length - 1} more)` : worst.title,
        tier: tierOf(worst),
        // The worst incident's own start, so the time matches the title next to it.
        sinceMs: worst.startedAt,
        status: p.status,
        monitoring: open.every(isMonitoring),
      });
    } else if (!snap.focus && isProblem(p.status) && !openIncidents(mine).length) {
      // Skipped in a narrowed view: a red status page doesn't say whether it's the part you use.
      // A status page still flagged by a long-running incident isn't news either.
      const broken = brokenComponents(p).items.map((c) => c.name);
      out.push({
        provider: p,
        title: broken.length ? `Problems reported on ${broken.slice(0, 3).join(", ")}${broken.length > 3 ? "…" : ""}` : "Status page reports a problem",
        tier: STATUS_TIER[p.status] ?? null,
        sinceMs: p.since ?? snap.generatedAt,
        status: p.status,
        monitoring: false,
      });
    }
  }
  // Still broken first; ones the provider is watching a fix for go last.
  return out.sort((a, b) => Number(a.monitoring) - Number(b.monitoring) || (a.tier ?? 9) - (b.tier ?? 9) || a.sinceMs - b.sinceMs);
}

/** Whole days since any tracked provider last had a Sev 1 running. */
export function daysSinceSev1(snap: Snapshot): number | null {
  let last: number | null = null;
  for (const i of snap.incidents) {
    if (tierOf(i) !== 1) continue;
    // A region written off months ago stops counting after a week, as on the heatmap.
    const end = shownEnd(gradeInput(i), snap.generatedAt);
    if (last === null || end > last) last = end;
  }
  return last === null ? null : Math.floor((snap.generatedAt - last) / DAY);
}

export interface BoardRow {
  provider: ProviderRow;
  score: Score;
  cells: DayCell[];
  /** Live tag, if the provider is in the down-right-now banner. */
  live: LiveLevel | null;
  /** Days of the 90-day window our data covers. */
  covered: number;
  /** False when there's too little data to grade or rank. */
  graded: boolean;
}

export function leaderboard(snap: Snapshot, category: string, sort: "worst" | "best" = "worst"): BoardRow[] {
  const live = new Map(downNow(snap).map((d) => [d.provider.id, liveLevel(d)]));
  const rows = snap.providers
    .filter((p) => p.category === category)
    .map((p) => ({
      provider: p,
      score: scoreFor(snap, p.id),
      cells: dailyCells(incidentsFor(snap, p.id), 60, snap.generatedAt, dataFrom(p)),
      live: live.get(p.id) ?? null,
      covered: coveredDays(p, snap.generatedAt),
      graded: isGraded(p, snap.generatedAt),
    }));
  rows.sort((a, b) => b.score.points - a.score.points || a.score.admittedUptime - b.score.admittedUptime || a.provider.name.localeCompare(b.provider.name));
  const ranked = rows.filter((r) => r.graded);
  // Too little data to rank: listed after everyone else, whichever way the board is sorted.
  return [...(sort === "best" ? ranked.reverse() : ranked), ...rows.filter((r) => !r.graded)];
}

export function totals(snap: Snapshot, days = 90) {
  const from = snap.generatedAt - days * DAY;
  const list = snap.incidents.filter((i) => tierOf(i) > 0 && (i.resolvedAt ?? snap.generatedAt) > from);
  let downtime = 0;
  for (const p of snap.providers) downtime += scoreFor(snap, p.id, days).sev1Minutes;
  const dns = list.filter((i) => /\bdns\b/i.test(i.title) || i.components.some((c) => /\bdns\b/i.test(c))).length;
  const sev1 = list.filter((i) => tierOf(i) === 1).length;
  return { incidents: list.length, sev1, sev1Minutes: downtime, providers: snap.providers.length, dns };
}

export function monthlyTrend(list: IncidentRow[], now: number, months = 12) {
  const d = new Date(now);
  const out: { start: number; count: number; worst: number }[] = [];
  for (let k = months - 1; k >= 0; k--) {
    const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - k, 1);
    const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - k + 1, 1);
    const inMonth = list.filter((i) => tierOf(i) > 0 && i.startedAt >= start && i.startedAt < end);
    out.push({ start, count: inMonth.length, worst: Math.min(5, ...inMonth.map(tierOf)) });
  }
  return out;
}

/** Whether we hold data for the whole trend window, so "last 6 months vs the 6 before" compares like with like. */
export function trendKnown(p: Pick<ProviderRow, "historyFrom" | "trackedFrom">, trend: { start: number }[]): boolean {
  const from = dataFrom(p);
  return from == null || !trend.length || from <= trend[0].start;
}

/** Incident start times by UTC weekday (Mon first) and hour. */
export function startHeatmap(list: IncidentRow[]): number[][] {
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const i of list) {
    if (tierOf(i) === 0) continue;
    const d = new Date(i.startedAt);
    grid[(d.getUTCDay() + 6) % 7][d.getUTCHours()]++;
  }
  return grid;
}

export interface BrokenComponents {
  items: { name: string; group?: string; status: Status }[];
  /** Counts per status, worst first, zero counts left out. */
  byStatus: [Status, number][];
  /** Counts per component group (e.g. region), largest first. */
  groups: [string, number][];
}

/** A provider's non-green components, summarised so a 40-city outage fits on two lines. */
export function brokenComponents(p: ProviderRow): BrokenComponents {
  // A re-routed city is routine on a big network; the provider doesn't headline it, so neither do we.
  const items = p.components
    .filter((c) => isProblem(c.status) && !isLocation(c.name))
    .sort((a, b) => statusRank(b.status) - statusRank(a.status) || (a.group ?? "").localeCompare(b.group ?? "") || a.name.localeCompare(b.name));
  const tally = <K,>(keys: K[]) => {
    const m = new Map<K, number>();
    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()];
  };
  return {
    items,
    byStatus: tally(items.map((c) => c.status)),
    groups: tally(items.flatMap((c) => (c.group ? [c.group] : []))).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
}

export function topComponents(list: IncidentRow[], n = 6) {
  // Some pages list a component both bare and under its group ("North America - Ashburn - (IAD)"):
  // count those as one.
  const names = new Set(list.flatMap((i) => i.components));
  const canon = (c: string) => {
    const bare = c.slice(c.indexOf(" - ") + 3);
    return c.includes(" - ") && names.has(bare) ? bare : c;
  };
  const counts = new Map<string, number>();
  for (const i of list) for (const c of new Set(i.components.map(canon))) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));
}

export function communication(list: IncidentRow[], updates: Record<number, { postedAt: number }[]>) {
  const gaps: number[] = [];
  let withUpdates = 0;
  for (const i of list) {
    const u = updates[i.id];
    if (!u?.length) continue;
    withUpdates++;
    for (let k = 1; k < u.length; k++) gaps.push((u[k].postedAt - u[k - 1].postedAt) / 60_000);
  }
  gaps.sort((a, b) => a - b);
  const serious = list.filter((i) => tierOf(i) === 1 || tierOf(i) === 2);
  const resolved = list.filter((i) => i.resolvedAt);
  return {
    medianGapMinutes: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null,
    updatesPerIncident: withUpdates ? Object.values(updates).reduce((n, u) => n + u.length, 0) / withUpdates : null,
    postmortems: serious.filter((i) => i.postmortem).length,
    serious: serious.length,
    medianResolveMinutes: resolved.length ? resolved.map((i) => durationMinutes(gradeInput(i))).sort((a, b) => a - b)[Math.floor(resolved.length / 2)] : null,
  };
}

export interface ValueRow {
  provider: ProviderRow;
  score: Score;
  price: Price | undefined;
  usd: number | null;
  bestValue: boolean;
  beatenBy: ProviderRow | null;
}

/** A category's providers by reference-workload price, cheapest first, with the value frontier marked. */
export function valueBoard(snap: Snapshot, category: string): ValueRow[] {
  const provs = snap.providers.filter((p) => p.category === category);
  const rows = provs.map((p) => {
    const price = PRICES[p.slug];
    const score = scoreFor(snap, p.id);
    return { provider: p, score, price, usd: monthlyUsd(price) };
  });
  // No grade, no place on the frontier.
  const frontier = valueFrontier(
    rows.map((r) => ({ id: r.provider.slug, usd: isGraded(r.provider, snap.generatedAt) ? r.usd : null, gradeRank: gradeRank(r.score.grade) })),
  );
  return rows
    .map((r) => {
      const v = frontier[r.provider.slug];
      return { ...r, bestValue: v?.bestValue ?? false, beatenBy: provs.find((p) => p.slug === v?.beatenBy) ?? null };
    })
    .sort((a, b) => (a.usd ?? Infinity) - (b.usd ?? Infinity) || gradeRank(a.score.grade) - gradeRank(b.score.grade) || a.provider.name.localeCompare(b.provider.name));
}

export interface GradeCause {
  incident: IncidentRow;
  points: number;
  /** Share of the provider's points, 0 to 1. */
  share: number;
}

/** What a 90-day grade is made of: the incidents that cost the most points, biggest first. */
export function gradeCauses(snap: Snapshot, providerId: number, n = 3, days = 90): { top: GradeCause[]; rest: number; total: number } {
  const { from, to } = windowBounds(new Date(snap.generatedAt), days);
  const costs = incidentsFor(snap, providerId)
    .filter((i) => tierOf(i) > 0 && i.startedAt < to.getTime() && (i.resolvedAt ?? snap.generatedAt) > from.getTime())
    .map((incident) => ({ incident, points: focusPoints(snap, incident, from, to) }))
    .filter((c) => c.points > 0 || !snap.focus)
    .sort((a, b) => b.points - a.points || tierOf(a.incident) - tierOf(b.incident));
  const total = costs.reduce((t, c) => t + c.points, 0);
  return {
    top: costs.slice(0, n).map((c) => ({ ...c, share: total ? c.points / total : 0 })),
    rest: Math.max(0, costs.length - n),
    total,
  };
}

/** What one incident cost the grade as shown: every area normally, only the focused ones in a narrowed view. */
function focusPoints(snap: Snapshot, i: IncidentRow, from: Date, to: Date): number {
  const areas = snap.focus?.areas;
  if (!areas || areas.length === AREAS.length) return incidentPoints(gradeInput(i), from, to);
  const minutes = penaltyMinutes(gradeInput(i), from, to) * scopeWeight(i.scope);
  return areas.reduce((t, a) => t + (TIER_WEIGHT[i.areaTiers?.[a] ?? 0] ?? 0) * minutes, 0);
}
