// Heroku's status API: GET {base}/api/v4/current-status
//   { status: [{ system: "Apps"|"Data"|"Tools", status: "green"|"yellow"|"red"|"blue" }],
//     incidents: [...], scheduled: [...] }
import type { Getter, NormalizedComponent, NormalizedIncident, ProviderSnapshot, Status } from "@/lib/types";
import { impactFromStatus, worstStatus } from "@/lib/status";

interface HkIncident {
  id: number | string;
  title: string;
  state?: string;
  created_at: string;
  updated_at?: string | null;
  resolved_at?: string | null;
  resolved?: boolean;
  full_url?: string;
  systems?: { name: string; status: string }[];
  updates?: { id: number | string; created_at: string; contents: string; update_type: string }[];
}

export function mapHkStatus(s: string | undefined): Status {
  switch (s) {
    case "green":
      return "operational";
    case "yellow":
      return "degraded";
    case "red":
      return "major_outage";
    case "blue":
      return "maintenance";
    default:
      return "unknown";
  }
}

// Heroku reports three systems. Name them so the surface rules classify them.
const SYSTEM_NAMES: Record<string, string> = {
  Apps: "Apps (runtime)",
  Data: "Data (Postgres, Redis, Kafka)",
  Tools: "Tools (deploys, dashboard, CLI)",
};

export function normalizeHkIncident(i: HkIncident): NormalizedIncident {
  const updates = (i.updates ?? [])
    .map((u) => ({ externalId: String(u.id), status: u.update_type, body: u.contents ?? "", postedAt: new Date(u.created_at) }))
    .sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
  const worst = worstStatus((i.systems ?? []).map((s) => mapHkStatus(s.status)));
  const resolved = i.resolved || Boolean(i.resolved_at);
  return {
    externalId: String(i.id),
    title: i.title,
    impact: impactFromStatus(worst),
    status: resolved ? "resolved" : (updates.at(-1)?.status ?? "investigating"),
    startedAt: new Date(i.created_at),
    monitoringAt: updates.find((u) => u.status === "monitoring")?.postedAt ?? null,
    resolvedAt: i.resolved_at ? new Date(i.resolved_at) : null,
    sourceUpdatedAt: i.updated_at ? new Date(i.updated_at) : null,
    url: i.full_url ?? null,
    components: [...new Set((i.systems ?? []).map((s) => SYSTEM_NAMES[s.name] ?? s.name))],
    worstComponentStatus: worst === "operational" ? null : worst,
    postmortem: false,
    updates,
    raw: i,
  };
}

export async function fetchHeroku(base: string, _pageUrl: string, get: Getter): Promise<ProviderSnapshot> {
  const res = await get(`${base.replace(/\/$/, "")}/api/v4/current-status`);
  if (res.notModified) return {};
  const body = res.body as { status?: { system: string; status: string }[]; incidents?: HkIncident[] };
  if (!body || !Array.isArray(body.status)) throw new Error("heroku current-status: unexpected shape");
  const components: NormalizedComponent[] = body.status.map((s) => ({
    name: SYSTEM_NAMES[s.system] ?? s.system,
    status: mapHkStatus(s.status),
  }));
  return {
    status: worstStatus(components.map((c) => c.status)),
    components,
    incidents: (body.incidents ?? []).map(normalizeHkIncident),
    raw: { status: body },
  };
}
