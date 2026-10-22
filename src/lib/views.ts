// Pure functions that turn the cached snapshot into what each page shows.
import { durationMinutes, effectiveTier, gradeRank, penaltyMinutes, score, windowBounds, type GradeInput, type Score } from "@/lib/grading";
import { SECURITY_PENALTY, TIER_WEIGHT } from "@/lib/severity";
import { PRICES, monthlyUsd, valueFrontier, type Price } from "@/lib/pricing";
import type { IncidentRow, ProviderRow, Snapshot } from "@/lib/data";
import { isProblem, statusRank } from "@/lib/status";
import type { Status } from "@/lib/types";

const DAY = 86_400_000;

export function gradeInput(i: IncidentRow): GradeInput {
  return {
    startedAt: new Date(i.startedAt),
    monitoringAt: i.monitoringAt ? new Date(i.monitoringAt) : null,
    resolvedAt: i.resolvedAt ? new Date(i.resolvedAt) : null,
    tier: i.tier,
    tierOverride: i.tierOverride,
    areaTiers: i.areaTiers,
    surfaces: i.surfaces,
    security: i.security,
    scope: i.scope,
  };
}

export const tierOf = (i: IncidentRow) => effectiveTier(i);

export function incidentsFor(snap: Snapshot, providerId: number): IncidentRow[] {
  return snap.incidents.filter((i) => i.providerId === providerId);
}

export function scoreFor(snap: Snapshot, providerId: number, days = 90, now = snap.generatedAt): Score {
  const { from, to } = windowBounds(new Date(now), days);
  return score(incidentsFor(snap, providerId).map(gradeInput), from, to);
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
      if (i.startedAt < end && (i.resolvedAt ?? now) >= start) worst = Math.min(worst, t);
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
  const long = (i: IncidentRow) => (i.resolvedAt ?? now) - i.startedAt;
  const out: DayLoad[] = [];
  for (let d = days - 1; d >= 0; d--) {
    const start = today - d * DAY;
    const end = Math.min(start + DAY, now);
    const cell: DayLoad = { day: start, points: 0, incidents: 0, worst: 5, top: null };
    for (const i of list) {
      const t = tierOf(i);
      if (t === 0 || i.startedAt >= start + DAY || (i.resolvedAt ?? now) < start) continue;
      cell.incidents++;
      if (t < cell.worst || (t === cell.worst && cell.top && long(i) > long(cell.top))) cell.top = i;
      cell.worst = Math.min(cell.worst, t);
      cell.points += TIER_WEIGHT[t] * penaltyMinutes(gradeInput(i), new Date(start), new Date(end));
      if (i.security && i.startedAt >= start) cell.points += SECURITY_PENALTY;
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

export interface DownItem {
  provider: ProviderRow;
  title: string;
  tier: number | null;
  sinceMs: number;
  status: Status;
}

const STATUS_TIER: Partial<Record<Status, number>> = { major_outage: 1, partial_outage: 2, degraded: 2 };

/** "down" is Sev 1 or a major outage; anything milder in the banner is "issues". */
export type LiveLevel = "down" | "issues";
export const LIVE_LABEL: Record<LiveLevel, string> = { down: "DOWN", issues: "ISSUES" };

export function liveLevel(d: Pick<DownItem, "tier" | "status">): LiveLevel {
  return d.tier === 1 || d.status === "major_outage" ? "down" : "issues";
}

/** "2 down · 1 issues"-style count for a set of providers, or null when all are up. */
export function liveCount(items: DownItem[]): string | null {
  const down = items.filter((d) => liveLevel(d) === "down").length;
  const issues = items.length - down;
  const parts = [down ? `${down} down` : null, issues ? `${issues} ${issues === 1 ? "issue" : "issues"}` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Providers reporting a problem right now: an open Sev 1–3 incident, or a
 * non-green status with no incident posted. An open Sev 4 alone doesn't count.
 */
export function downNow(snap: Snapshot): DownItem[] {
  const out: DownItem[] = [];
  for (const p of snap.providers) {
    const open = openIncidents(incidentsFor(snap, p.id)).sort((a, b) => tierOf(a) - tierOf(b));
    if (open.length) {
      const worst = open[0];
      if (tierOf(worst) > 3) continue;
      out.push({
        provider: p,
        title: open.length > 1 ? `${worst.title} (+${open.length - 1} more)` : worst.title,
        tier: tierOf(worst),
        sinceMs: Math.min(...open.map((i) => i.startedAt)),
        status: p.status,
      });
    } else if (isProblem(p.status)) {
      const broken = p.components.filter((c) => isProblem(c.status)).map((c) => c.name);
      out.push({
        provider: p,
        title: broken.length ? `Problems reported on ${broken.slice(0, 3).join(", ")}${broken.length > 3 ? "…" : ""}` : "Status page reports a problem",
        tier: STATUS_TIER[p.status] ?? null,
        sinceMs: p.since ?? snap.generatedAt,
        status: p.status,
      });
    }
  }
  return out.sort((a, b) => (a.tier ?? 9) - (b.tier ?? 9) || a.sinceMs - b.sinceMs);
}

/** Whole days since any tracked provider last had a Sev 1 running. */
export function daysSinceSev1(snap: Snapshot): number | null {
  let last: number | null = null;
  for (const i of snap.incidents) {
    if (tierOf(i) !== 1) continue;
    const end = i.resolvedAt ?? snap.generatedAt;
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
}

export function leaderboard(snap: Snapshot, category: string, sort: "worst" | "best" = "worst"): BoardRow[] {
  const live = new Map(downNow(snap).map((d) => [d.provider.id, liveLevel(d)]));
  const rows = snap.providers
    .filter((p) => p.category === category)
    .map((p) => ({
      provider: p,
      score: scoreFor(snap, p.id),
      cells: dailyCells(incidentsFor(snap, p.id), 60, snap.generatedAt, p.historyFrom),
      live: live.get(p.id) ?? null,
    }));
  rows.sort((a, b) => b.score.points - a.score.points || a.score.admittedUptime - b.score.admittedUptime || a.provider.name.localeCompare(b.provider.name));
  return sort === "best" ? rows.reverse() : rows;
}

export function totals(snap: Snapshot, days = 90) {
  const from = snap.generatedAt - days * DAY;
  const list = snap.incidents.filter((i) => tierOf(i) > 0 && (i.resolvedAt ?? snap.generatedAt) > from);
  let downtime = 0;
  for (const p of snap.providers) downtime += scoreFor(snap, p.id, days).sev1Minutes;
  const dns = list.filter((i) => /\bdns\b/i.test(i.title) || i.components.some((c) => /\bdns\b/i.test(c))).length;
  return { incidents: list.length, sev1Minutes: downtime, providers: snap.providers.length, dns };
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
  const items = p.components
    .filter((c) => isProblem(c.status))
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
  const counts = new Map<string, number>();
  for (const i of list) for (const c of i.components) counts.set(c, (counts.get(c) ?? 0) + 1);
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
  const frontier = valueFrontier(rows.map((r) => ({ id: r.provider.slug, usd: r.usd, gradeRank: gradeRank(r.score.grade) })));
  return rows
    .map((r) => {
      const v = frontier[r.provider.slug];
      return { ...r, bestValue: v?.bestValue ?? false, beatenBy: provs.find((p) => p.slug === v?.beatenBy) ?? null };
    })
    .sort((a, b) => (a.usd ?? Infinity) - (b.usd ?? Infinity) || gradeRank(a.score.grade) - gradeRank(b.score.grade) || a.provider.name.localeCompare(b.provider.name));
}
