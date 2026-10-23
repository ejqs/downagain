// The numbers for a whole stack, shared by the /stack page and its README badge.
import type { Snapshot } from "@/lib/data";
import { score, windowBounds, type Score } from "@/lib/grading";
import { applyFilter, type NeedFilter } from "@/lib/needs";
import { stackEntries, type StackEntry, type StackPick } from "@/lib/stack";
import { gradeInput, isGraded, isMonitoring, liveIncidents, tierOf, type LiveLevel } from "@/lib/views";

export interface StackSummary {
  entries: (StackEntry & { score: Score; graded: boolean })[];
  /** Every pick's incidents together, newest first. */
  all: StackEntry["incidents"];
  score: Score;
  /** False while any pick has too little data to grade. */
  graded: boolean;
  /** Picks with an open incident that hits what was picked, worst first. */
  live: { name: string; level: LiveLevel }[];
}

export function stackSummary(snap: Snapshot, picks: StackPick[], filter: NeedFilter): StackSummary {
  const view = applyFilter(snap, filter);
  const now = view.generatedAt;
  const { from, to } = windowBounds(new Date(now));
  const scoreOf = (list: StackEntry["incidents"]) => score(list.map(gradeInput), from, to);
  const entries = stackEntries(view, picks).map((e) => ({ ...e, score: scoreOf(e.incidents), graded: isGraded(e.provider, now) }));
  const all = entries.flatMap((e) => e.incidents).sort((a, b) => b.startedAt - a.startedAt);
  // Live means an open Sev 1-3 incident in what you use, not just a red status page.
  const live = entries
    .map((e) => {
      const open = liveIncidents(e.incidents, now);
      return { name: e.provider.name, worst: Math.min(5, ...open.map(tierOf)), monitoring: open.every(isMonitoring) };
    })
    .filter((e) => e.worst <= 3)
    .sort((a, b) => Number(a.monitoring) - Number(b.monitoring) || a.worst - b.worst)
    .map((e) => ({ name: e.name, level: (e.monitoring ? "monitoring" : e.worst === 1 ? "down" : "issues") as LiveLevel }));
  return { entries, all, score: scoreOf(all), graded: entries.length > 0 && entries.every((e) => e.graded), live };
}
