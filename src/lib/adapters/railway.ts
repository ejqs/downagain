// Railway's own status API. status.railway.com rejects scripts, but this is the
// JSON the page itself reads. Shape checked by hand on 2026-10-22.
//   { components: [group | component], incidents: [...], maintenances: [...] }
import type { Getter, NormalizedComponent, NormalizedIncident, ProviderSnapshot, Status } from "@/lib/types";
import { impactFromStatus, worstStatus } from "@/lib/status";

interface RwComponent {
  id: string;
  name: string;
  type?: "group" | "component";
  status?: string;
  components?: RwComponent[];
}
export interface RwIncident {
  id: string;
  slug?: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt?: string | null;
  resolvedAt?: string | null;
  worstImpact?: string | null;
  components?: { component: { id: string; name: string; groupName?: string | null }; impact?: string }[];
  updates?: { id: string; createdAt: string; message: string; status: string }[];
}
interface RwStatus {
  components?: RwComponent[];
  incidents?: RwIncident[];
  maintenances?: { status?: string }[];
}

export function mapRwStatus(s: string | null | undefined): Status {
  switch ((s ?? "").toUpperCase()) {
    case "OPERATIONAL":
      return "operational";
    case "DEGRADED_PERFORMANCE":
    case "DEGRADED":
      return "degraded";
    case "PARTIAL_OUTAGE":
      return "partial_outage";
    case "MAJOR_OUTAGE":
    case "FULL_OUTAGE":
      return "major_outage";
    case "UNDER_MAINTENANCE":
    case "MAINTENANCE":
      return "maintenance";
    default:
      return "unknown";
  }
}

function flatten(list: RwComponent[] = [], group?: string): NormalizedComponent[] {
  return list.flatMap((c) =>
    c.type === "group" || c.components
      ? flatten(c.components ?? [], c.name)
      : [{ name: c.name, status: mapRwStatus(c.status), group }],
  );
}

export function normalizeRwIncident(i: RwIncident, pageUrl: string): NormalizedIncident {
  const updates = (i.updates ?? [])
    .map((u) => ({ externalId: u.id, status: u.status.toLowerCase(), body: u.message ?? "", postedAt: new Date(u.createdAt) }))
    .sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
  const compStatuses = (i.components ?? []).map((c) => mapRwStatus(c.impact));
  const worst = worstStatus([mapRwStatus(i.worstImpact), ...compStatuses]);
  return {
    externalId: i.id,
    title: i.title,
    impact: impactFromStatus(worst),
    status: i.status.toLowerCase(),
    startedAt: new Date(i.createdAt),
    monitoringAt: updates.find((u) => u.status === "monitoring")?.postedAt ?? null,
    resolvedAt: i.resolvedAt ? new Date(i.resolvedAt) : null,
    sourceUpdatedAt: i.updatedAt ? new Date(i.updatedAt) : null,
    url: i.slug ? `${pageUrl.replace(/\/$/, "")}/incident/${i.slug}` : pageUrl,
    components: (i.components ?? []).map((c) => c.component.name),
    worstComponentStatus: worst === "operational" ? null : worst,
    postmortem: false,
    updates,
    raw: i,
  };
}

export async function fetchRailway(base: string, pageUrl: string, get: Getter): Promise<ProviderSnapshot> {
  const res = await get(base);
  if (res.notModified) return {};
  const body = res.body as RwStatus;
  if (!body || !Array.isArray(body.components)) throw new Error("railway status: unexpected shape");
  const components = flatten(body.components);
  const incidents = (body.incidents ?? []).map((i) => normalizeRwIncident(i, pageUrl));
  const active = incidents.filter((i) => !i.resolvedAt).map((i) => i.worstComponentStatus ?? "degraded");
  const inMaintenance = (body.maintenances ?? []).some((m) => /IN_PROGRESS|ACTIVE/i.test(m.status ?? ""));
  return {
    // Railway has no overall field, so we derive it.
    status: worstStatus([...components.map((c) => c.status), ...active, ...(inMaintenance ? (["maintenance"] as Status[]) : [])]),
    components,
    incidents,
    raw: { status: body },
  };
}
