// Shared bits for the big clouds (GCP, AWS, Azure). None of them publish a
// component list with live statuses the way Statuspage does, so the overall
// status and the component list come from the incidents that are still open.
import type { NormalizedComponent, NormalizedIncident, Status } from "@/lib/types";
import { statusRank, worstStatus } from "@/lib/status";

/**
 * The provider's overall status. An incident confined to one region shows the
 * cloud as degraded at worst: us-east-1 having a bad day is news, but the other
 * thirty-odd regions are fine and the banner shouldn't say the whole cloud is down.
 */
export function cloudStatus(open: NormalizedIncident[]): Status {
  return worstStatus(
    open.map((i) => {
      const s = i.worstComponentStatus ?? "degraded";
      return i.regions?.length === 1 && statusRank(s) > statusRank("degraded") ? "degraded" : s;
    }),
  );
}

/** One component per affected product of each open incident, grouped by region. */
export function cloudComponents(open: NormalizedIncident[]): NormalizedComponent[] {
  const out = new Map<string, NormalizedComponent>();
  for (const i of open) {
    const group = i.regions?.length ? i.regions.join(", ") : "Global";
    for (const name of i.components) {
      const key = `${group}\u0000${name}`;
      const status = i.worstComponentStatus ?? "degraded";
      const prev = out.get(key);
      out.set(key, { name, group, status: prev ? worstStatus([prev.status, status]) : status });
    }
  }
  return [...out.values()];
}

export const uniq = <T,>(list: T[]) => [...new Set(list)];
