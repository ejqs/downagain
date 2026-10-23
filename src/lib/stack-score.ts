// The numbers for a whole stack, shared by the /stack page and its README badge.
import type { Snapshot } from "@/lib/data";
import { score, windowBounds, type Score } from "@/lib/grading";
import { applyFilter, type NeedFilter } from "@/lib/needs";
import { AREAS, type Area } from "@/lib/severity";
import { stackEntries, type StackEntry, type StackPick } from "@/lib/stack";
import { focusScore, gradeInput, isGraded, liveIncidents, tierOf, type LiveLevel } from "@/lib/views";

export interface StackSummary {
  entries: (StackEntry & { score: Score; graded: boolean })[];
  /** Every pick's incidents together, newest first. */
  all: StackEntry["incidents"];
  score: Score;
  /** False while any pick has too little data to grade. */
  graded: boolean;
  /** The area grades that matter under the filter. */
  areas: Area[];
  /** Picks with an open incident that hits what was picked, worst first. */
  live: { name: string; level: LiveLevel }[];
}

export function stackSummary(snap: Snapshot, picks: StackPick[], filter: NeedFilter): StackSummary {
  const view = applyFilter(snap, filter);
  const now = view.generatedAt;
  const { from, to } = windowBounds(new Date(now));
  const scoreOf = (list: StackEntry["incidents"]) => {
    const s = score(list.map(gradeInput), from, to);
    return view.focus ? focusScore(s, view.focus.areas) : s;
  };
  const entries = stackEntries(view, picks).map((e) => ({ ...e, score: scoreOf(e.incidents), graded: isGraded(e.provider, now) }));
  const all = entries.flatMap((e) => e.incidents).sort((a, b) => b.startedAt - a.startedAt);
  // Live means an open Sev 1-3 incident in what you use, not just a red status page.
  const live = entries
    .map((e) => ({ name: e.provider.name, worst: Math.min(5, ...liveIncidents(e.incidents, now).map(tierOf)) }))
    .filter((e) => e.worst <= 3)
    .sort((a, b) => a.worst - b.worst)
    .map((e) => ({ name: e.name, level: (e.worst === 1 ? "down" : "issues") as LiveLevel }));
  return { entries, all, areas: view.focus?.areas ?? AREAS, score: scoreOf(all), graded: entries.length > 0 && entries.every((e) => e.graded), live };
}
