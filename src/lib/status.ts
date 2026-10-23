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

// One city's point of presence on a big network's page: Cloudflare's "Accra, Ghana - (ACC)".
const LOCATION_RE = /\s-\s\([A-Z]{3,4}\)\s*$/;

/** A component that is a single location, not a product. */
export function isLocation(name: string): boolean {
  return LOCATION_RE.test(name);
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

/**
 * Statuspage names a component bare on the incident ("Builds") and with its group in
 * the updates ("Build & Deploy - Builds"). Keep the grouped name, drop the bare twin.
 */
export function dropBareTwins(names: string[]): string[] {
  const unique = [...new Set(names)];
  const grouped = new Set(unique.filter((n) => n.includes(" - ")).map((n) => n.slice(n.lastIndexOf(" - ") + 3)));
  return unique.filter((n) => n.includes(" - ") || !grouped.has(n));
}
