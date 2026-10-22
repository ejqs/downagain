import type { Impact, Status } from "@/lib/types";

const RANK: Record<Status, number> = {
  operational: 0,
  unknown: 0,
  maintenance: 1,
  degraded: 2,
  partial_outage: 3,
  major_outage: 4,
};

export function statusRank(s: Status): number {
  return RANK[s];
}

export function worstStatus(list: Status[], fallback: Status = "operational"): Status {
  let worst = fallback;
  for (const s of list) if (RANK[s] > RANK[worst]) worst = s;
  return worst;
}

/** Statuses that put a provider in the "down right now" banner. */
export function isProblem(s: Status): boolean {
  return s === "degraded" || s === "partial_outage" || s === "major_outage";
}

export const STATUS_LABEL: Record<Status, string> = {
  operational: "Operational",
  degraded: "Degraded",
  partial_outage: "Partial outage",
  major_outage: "Major outage",
  maintenance: "Maintenance",
  unknown: "Status unknown",
};

export function impactFromStatus(s: Status | null | undefined): Impact {
  switch (s) {
    case "major_outage":
      return "critical";
    case "partial_outage":
      return "major";
    case "degraded":
      return "minor";
    default:
      return "none";
  }
}
