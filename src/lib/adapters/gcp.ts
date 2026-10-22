// Google Cloud Service Health: GET {base}/incidents.json, every incident Google
// has posted publicly with all its updates (schema: {base}/incidents.schema.json).
//   [{ id, begin, end?, modified, external_desc, severity: low|medium|high,
//      status_impact: SERVICE_INFORMATION|SERVICE_DISRUPTION|SERVICE_OUTAGE,
//      affected_products: [{ id, title }], currently_affected_locations: [{ id, title }],
//      previously_affected_locations: [...], updates: [{ created, when, text, status,
//      affected_locations }], uri }]
// Shape checked against the live file and its schema on 2026-10-22.
import type { Getter, NormalizedIncident, ProviderSnapshot, Status } from "@/lib/types";
import { impactFromStatus, worstStatus } from "@/lib/status";
import { cloudComponents, cloudStatus, uniq } from "./cloud";

interface GcpLocation {
  id: string;
  title?: string;
}
interface GcpUpdate {
  created: string;
  modified?: string;
  when?: string;
  text?: string;
  status?: string;
  affected_locations?: GcpLocation[];
}
interface GcpIncident {
  id: string;
  begin: string;
  end?: string | null;
  modified?: string | null;
  external_desc: string;
  severity?: string;
  status_impact?: string;
  affected_products?: { id?: string; title: string }[];
  service_name?: string;
  currently_affected_locations?: GcpLocation[];
  previously_affected_locations?: GcpLocation[];
  updates?: GcpUpdate[];
  uri?: string;
}

export function mapGcpStatus(s: string | undefined): Status {
  switch (s) {
    case "SERVICE_OUTAGE":
      return "major_outage";
    case "SERVICE_DISRUPTION":
      return "partial_outage";
    case "SERVICE_INFORMATION":
      return "degraded";
    case "AVAILABLE":
      return "operational";
    default:
      return "unknown";
  }
}

const UPDATE_LABEL: Record<string, string> = {
  SERVICE_OUTAGE: "outage",
  SERVICE_DISRUPTION: "disruption",
  SERVICE_INFORMATION: "information",
  AVAILABLE: "available",
};

/**
 * Specific regions only. "global" or a multi-region ("us", "eu", "nam4") means the
 * blast radius is wider than one region, so we report no regions (not capped).
 */
export function gcpRegions(locations: GcpLocation[]): string[] {
  const ids = uniq(locations.map((l) => l.id).filter(Boolean));
  if (ids.some((id) => id === "global" || !/\d$/.test(id))) return [];
  return ids.sort();
}

export function normalizeGcpIncident(i: GcpIncident, base: string): NormalizedIncident {
  const updates = (i.updates ?? [])
    .map((u) => ({
      externalId: u.created,
      status: UPDATE_LABEL[u.status ?? ""] ?? (u.status ?? "update").toLowerCase(),
      body: u.text ?? "",
      postedAt: new Date(u.when ?? u.created),
    }))
    .sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
  const locations = [
    ...(i.currently_affected_locations ?? []),
    ...(i.previously_affected_locations ?? []),
    ...(i.updates ?? []).flatMap((u) => u.affected_locations ?? []),
  ];
  const worst = worstStatus([mapGcpStatus(i.status_impact), ...(i.updates ?? []).map((u) => mapGcpStatus(u.status))]);
  const products = (i.affected_products ?? []).map((p) => p.title);
  return {
    externalId: i.id,
    title: i.external_desc.trim().split("\n")[0],
    impact: impactFromStatus(worst),
    status: i.end ? "resolved" : "investigating",
    startedAt: new Date(i.begin),
    // Google has no "monitoring" step; the incident ends when they say it's over.
    monitoringAt: null,
    resolvedAt: i.end ? new Date(i.end) : null,
    sourceUpdatedAt: i.modified ? new Date(i.modified) : null,
    url: i.uri ? `${base}/${i.uri.replace(/^\//, "")}` : base,
    components: products.length ? products : i.service_name ? [i.service_name] : [],
    regions: gcpRegions(locations),
    worstComponentStatus: worst === "operational" || worst === "unknown" ? null : worst,
    postmortem: /incident report/i.test(updates.at(-1)?.body ?? ""),
    updates,
    raw: i,
  };
}

export async function fetchGcp(base: string, _pageUrl: string, get: Getter): Promise<ProviderSnapshot> {
  const root = base.replace(/\/$/, "");
  const res = await get(`${root}/incidents.json`, { large: true });
  if (res.notModified) return {};
  if (!Array.isArray(res.body)) throw new Error("gcp incidents.json: unexpected shape");
  const incidents = (res.body as GcpIncident[]).map((i) => normalizeGcpIncident(i, root));
  const open = incidents.filter((i) => !i.resolvedAt);
  return {
    status: cloudStatus(open),
    components: cloudComponents(open),
    incidents,
    // The full history is megabytes and already lives in the incidents table.
    raw: { status: { open: open.map((i) => i.raw) } },
  };
}
