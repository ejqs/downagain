// Groups a provider's related incidents into one timeline for the history list:
// a breach and its key rotations, an outage and the side effects posted on their
// own. Display only: every incident still scores on its own (grading.ts).
import type { IncidentRow } from "@/lib/data";
import { BREACH_FOLLOW_UP_DAYS, FOLLOW_UP_DAYS, MAX_SHOWN_DAYS, effectiveTier } from "@/lib/grading";

const MIN = 60_000;
const DAY = 86_400_000;
/** A post that lands this soon after an incident closes is still part of it. */
export const OVERLAP_GRACE_MINUTES = 30;

export interface Timeline {
  /** The worst member, earliest on a tie: its title heads the timeline. */
  lead: IncidentRow;
  /** Oldest first. */
  members: IncidentRow[];
  startedAt: number;
  /** Last member to close, or null while any is open. */
  resolvedAt: number | null;
  /** Worst member tier, 0 when none counted. */
  tier: number;
  security: boolean;
}

export type HistoryEntry = { kind: "incident"; incident: IncidentRow } | { kind: "timeline"; timeline: Timeline };

// Words that say nothing about which outage it was.
const FILLER = new Set("a an and are as at be by for from in is of on or some the to users with we our has have been being issue issues".split(" "));

/** The words of a title that name the outage, plurals folded: "Elevated Errors in ap-southeast-1" → elevated, error, ap-southeast-1. */
export function titleWords(title: string): Set<string> {
  const words = title.toLowerCase().match(/[a-z0-9][a-z0-9.-]*/g) ?? [];
  return new Set(words.filter((w) => !FILLER.has(w)).map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w)));
}

/** Share of words two titles have in common (Jaccard). */
export function titleMatch(a: string, b: string): number {
  const [x, y] = [titleWords(a), titleWords(b)];
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / (new Set([...x, ...y]).size || 1);
}

/** Titles this close, posted while the first was open, are the same outage posted twice. */
export const REPOST_MATCH = 0.75;

/**
 * Whether `b` (the later one) continues `a`. Three ways: Claude read `b` and named
 * `a`; both are security incidents within a week of a compromise (one breach, as in
 * onePenaltyPerBreach); or `b` reposts `a` while it was still open, with nearly the
 * same title and a shared component and region. Overlap alone isn't enough: busy pages run
 * unrelated incidents on the same component side by side.
 */
export function continues(a: IncidentRow, b: IncidentRow, now: number): boolean {
  if (a.providerId !== b.providerId || b.startedAt < a.startedAt || a.id === b.id) return false;
  const gap = b.startedAt - a.startedAt;
  if (b.follows === a.id) return gap <= FOLLOW_UP_DAYS * DAY;
  if (a.security && b.security && (a.compromise || b.compromise) && gap <= BREACH_FOLLOW_UP_DAYS * DAY) return true;
  if (effectiveTier(a) === 0 || effectiveTier(b) === 0 || gap > MAX_SHOWN_DAYS * DAY) return false;
  if (b.startedAt > (a.resolvedAt ?? now) + OVERLAP_GRACE_MINUTES * MIN) return false;
  // Empty means not stated, so it doesn't rule a match out.
  const meet = (x?: string[] | null, y?: string[] | null) => !x?.length || !y?.length || x.some((v) => y.includes(v));
  return meet(a.components, b.components) && meet(a.regions, b.regions) && titleMatch(a.title, b.title) >= REPOST_MATCH;
}

function toTimeline(members: IncidentRow[]): Timeline {
  const sorted = [...members].sort((x, y) => x.startedAt - y.startedAt || x.id - y.id);
  const rank = (i: IncidentRow) => effectiveTier(i) || 5;
  const lead = sorted.reduce((best, i) => (rank(i) < rank(best) ? i : best));
  const open = sorted.some((i) => i.resolvedAt == null);
  return {
    lead,
    members: sorted,
    startedAt: sorted[0].startedAt,
    resolvedAt: open ? null : Math.max(...sorted.map((i) => i.resolvedAt!)),
    tier: rank(lead) === 5 ? 0 : rank(lead),
    security: sorted.some((i) => i.security),
  };
}

/**
 * A provider's history with related incidents folded into timelines, newest first.
 * A timeline sits where its newest member would, so a fresh follow-up keeps the
 * whole story at the top.
 */
export function withTimelines(list: IncidentRow[], now: number): HistoryEntry[] {
  const byStart = [...list].sort((a, b) => a.startedAt - b.startedAt || a.id - b.id);
  const parent = new Map<number, number>(byStart.map((i) => [i.id, i.id]));
  const root = (id: number): number => {
    const p = parent.get(id)!;
    if (p === id) return id;
    const r = root(p);
    parent.set(id, r);
    return r;
  };
  for (let k = 0; k < byStart.length; k++) {
    const b = byStart[k];
    // Only incidents that started in the reach of the longest rule can link.
    for (let j = k - 1; j >= 0 && b.startedAt - byStart[j].startedAt <= FOLLOW_UP_DAYS * DAY; j--) {
      const a = byStart[j];
      if (continues(a, b, now)) parent.set(root(b.id), root(a.id));
    }
  }

  const groups = new Map<number, IncidentRow[]>();
  for (const i of byStart) {
    const r = root(i.id);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  }
  return [...groups.values()]
    .map((g): HistoryEntry & { at: number; id: number } => {
      const newest = g[g.length - 1];
      return g.length === 1
        ? { kind: "incident", incident: g[0], at: newest.startedAt, id: newest.id }
        : { kind: "timeline", timeline: toTimeline(g), at: newest.startedAt, id: newest.id };
    })
    .sort((a, b) => b.at - a.at || b.id - a.id)
    .map(({ at: _at, id: _id, ...e }) => e as HistoryEntry);
}
