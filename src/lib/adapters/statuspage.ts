// Atlassian Statuspage public API (also served by incident.io pages that keep the
// Statuspage-compatible endpoints, e.g. status.openai.com).
//   GET {base}/api/v2/summary.json    overall indicator, components, unresolved incidents
//   GET {base}/api/v2/incidents.json  last ~50 incidents with every update
import type { Getter, NormalizedComponent, NormalizedIncident, ProviderSnapshot, Status } from "@/lib/types";
import type { Impact } from "@/db/schema";
import { worstStatus } from "@/lib/status";

interface SpComponent {
  id: string;
  name: string;
  status: string;
  group_id?: string | null;
  group?: boolean;
}
interface SpAffected {
  code?: string;
  name: string;
  old_status?: string;
  new_status?: string;
}
interface SpUpdate {
  id: string;
  status: string;
  body: string;
  created_at: string;
  display_at?: string;
  affected_components?: SpAffected[] | null;
}
interface SpIncident {
  id: string;
  name: string;
  status: string;
  impact: string;
  created_at: string;
  started_at?: string | null;
  updated_at?: string | null;
  monitoring_at?: string | null;
  resolved_at?: string | null;
  shortlink?: string | null;
  components?: SpComponent[];
  incident_updates?: SpUpdate[];
  postmortem_body?: string | null;
  postmortem_published_at?: string | null;
}
interface SpSummary {
  page?: { url?: string };
  status?: { indicator?: string };
  components?: SpComponent[];
  incidents?: SpIncident[];
}

export function mapSpStatus(s: string | undefined | null): Status {
  switch (s) {
    case "operational":
      return "operational";
    case "degraded_performance":
      return "degraded";
    case "partial_outage":
      return "partial_outage";
    case "major_outage":
      return "major_outage";
    case "under_maintenance":
      return "maintenance";
    default:
      return "unknown";
  }
}

function indicatorStatus(i: string | undefined): Status {
  switch (i) {
    case "none":
      return "operational";
    case "minor":
      return "degraded";
    case "major":
      return "partial_outage";
    case "critical":
      return "major_outage";
    case "maintenance":
      return "maintenance";
    default:
      return "unknown";
  }
}

function mapImpact(i: string | undefined): Impact {
  return i === "minor" || i === "major" || i === "critical" ? i : "none";
}

const date = (s: string | null | undefined) => (s ? new Date(s) : null);

export function normalizeSpComponents(list: SpComponent[] = []): NormalizedComponent[] {
  const groups = new Map(list.filter((c) => c.group).map((c) => [c.id, c.name]));
  return list
    .filter((c) => !c.group)
    .map((c) => ({
      name: c.name,
      status: mapSpStatus(c.status),
      group: c.group_id ? groups.get(c.group_id) : undefined,
    }));
}

export function normalizeSpIncident(i: SpIncident, pageUrl: string): NormalizedIncident {
  const updates = (i.incident_updates ?? [])
    .map((u) => ({
      externalId: u.id,
      status: u.status,
      body: u.body ?? "",
      postedAt: new Date(u.display_at ?? u.created_at),
    }))
    .sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());

  const names = new Set<string>();
  const statuses: Status[] = [];
  for (const c of i.components ?? []) names.add(c.name);
  for (const u of i.incident_updates ?? []) {
    for (const a of u.affected_components ?? []) {
      names.add(a.name);
      if (a.new_status) statuses.push(mapSpStatus(a.new_status));
      if (a.old_status) statuses.push(mapSpStatus(a.old_status));
    }
  }

  const firstMonitoring = updates.find((u) => u.status === "monitoring")?.postedAt ?? null;

  return {
    externalId: i.id,
    title: i.name,
    impact: mapImpact(i.impact),
    status: i.status,
    startedAt: new Date(i.started_at ?? i.created_at),
    monitoringAt: date(i.monitoring_at) ?? firstMonitoring,
    resolvedAt: date(i.resolved_at),
    sourceUpdatedAt: date(i.updated_at),
    url: i.shortlink ?? `${pageUrl.replace(/\/$/, "")}/incidents/${i.id}`,
    components: [...names],
    worstComponentStatus: statuses.length ? worstStatus(statuses) : null,
    postmortem: Boolean(i.postmortem_body || i.postmortem_published_at || i.status === "postmortem"),
    updates,
    raw: i,
  };
}

export async function fetchStatuspage(base: string, pageUrl: string, get: Getter): Promise<ProviderSnapshot> {
  const root = base.replace(/\/$/, "");
  const [summaryRes, incidentsRes] = await Promise.all([
    get(`${root}/api/v2/summary.json`),
    get(`${root}/api/v2/incidents.json`),
  ]);
  const snap: ProviderSnapshot = { raw: {} };

  if (!summaryRes.notModified) {
    const s = summaryRes.body as SpSummary;
    if (!s || !Array.isArray(s.components)) throw new Error("summary.json: unexpected shape");
    const components = normalizeSpComponents(s.components);
    snap.components = components;
    snap.status = worstStatus([indicatorStatus(s.status?.indicator), ...components.map((c) => c.status)]);
    snap.raw!.summary = s;
  }

  if (!incidentsRes.notModified) {
    const body = incidentsRes.body as { incidents?: SpIncident[] };
    if (!body || !Array.isArray(body.incidents)) throw new Error("incidents.json: unexpected shape");
    snap.incidents = body.incidents.map((i) => normalizeSpIncident(i, pageUrl));
    snap.raw!.incidents = body;
  }
  return snap;
}
