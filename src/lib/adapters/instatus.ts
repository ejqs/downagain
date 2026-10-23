// Instatus pages (status.stytch.com, status.kinde.com). There is no public incident
// API, so history comes from the page's RSS feed (the last ~25 incidents):
//   GET {base}/summary.json        page status, plus open and recently resolved incidents with impact
//   GET {base}/v2/components.json  components with live status and group
//   GET {base}/history.rss         <item><title/><description>Type: Incident
//                                    Affected Components: Live API, Dashboard
//                                    Oct 22, 18:29:01 GMT+0 - Resolved - ... Oct 22, 16:00:12 GMT+0 - Investigating - ...
//                                  </description><pubDate/><link/><guid/></item>
// Update stamps carry no year, so it comes from the item's pubDate (the start).
// Maintenance items are skipped, as Statuspage's incidents.json leaves them out too.
import type { Getter, NormalizedComponent, NormalizedIncident, ProviderSnapshot, Status } from "@/lib/types";
import type { Impact } from "@/db/schema";
import { worstStatus } from "@/lib/status";
import { parseRss, type RssItem } from "./azure";

interface IsComponent {
  id: string;
  name: string;
  status: string;
  group?: { name?: string } | null;
}
interface IsIncident {
  id: string;
  name?: string;
  impact?: string;
  status?: string;
}
interface IsSummary {
  page?: { status?: string };
  activeIncidents?: IsIncident[];
  recentlyResolvedIncidents?: IsIncident[];
}

export function mapIsStatus(s: string | undefined | null): Status {
  switch (s?.toUpperCase()) {
    case "OPERATIONAL":
    case "UP":
      return "operational";
    case "DEGRADEDPERFORMANCE":
    case "HASISSUES":
      return "degraded";
    case "PARTIALOUTAGE":
      return "partial_outage";
    case "MAJOROUTAGE":
      return "major_outage";
    case "UNDERMAINTENANCE":
      return "maintenance";
    default:
      return "unknown";
  }
}

function mapIsImpact(i: string | undefined): Impact {
  switch (i?.toUpperCase()) {
    case "MAJOROUTAGE":
      return "critical";
    case "PARTIALOUTAGE":
      return "major";
    case "DEGRADEDPERFORMANCE":
      return "minor";
    default:
      return "none";
  }
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const STAMP_RE = /([A-Z][a-z]{2}) (\d{1,2}), (\d{2}):(\d{2}):(\d{2}) GMT([+-]\d{1,2})(?::?(\d{2}))? - ([A-Za-z ]+?) - /g;

/** "Oct 22, 18:29:01 GMT+0" in the year of `ref`, or the next one if that lands well before `ref`. */
function stampDate(m: RegExpExecArray, ref: Date): Date | null {
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  const sign = m[6].startsWith("-") ? -1 : 1;
  const offsetMin = sign * (Math.abs(Number(m[6])) * 60 + Number(m[7] ?? 0));
  const at = (year: number) => new Date(Date.UTC(year, month, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])) - offsetMin * 60_000);
  const d = at(ref.getUTCFullYear());
  // An incident that started Dec 31 and was resolved Jan 1.
  return d.getTime() < ref.getTime() - 2 * 86_400_000 ? at(ref.getUTCFullYear() + 1) : d;
}

export function parseIsDescription(text: string, ref: Date) {
  const type = /Type:\s*(\w+)/i.exec(text)?.[1].toLowerCase() ?? "incident";
  const affected = /Affected Components:([^\n]*)/i.exec(text)?.[1] ?? "";
  const components = [...new Set(affected.split(",").map((s) => s.trim()).filter(Boolean))];
  const stamps = [...text.matchAll(STAMP_RE)];
  const updates = stamps.flatMap((m, i) => {
    const postedAt = stampDate(m, ref);
    if (!postedAt) return [];
    const end = i + 1 < stamps.length ? stamps[i + 1].index : text.length;
    const body = text.slice(m.index + m[0].length, end).trim();
    return [{ status: m[8].trim().toLowerCase(), body, postedAt }];
  });
  return { type, components, updates: updates.sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime()) };
}

const idFrom = (item: RssItem) => (item.guid ?? item.link ?? item.title).replace(/\/$/, "").split("/").pop()!;

export function normalizeIsItem(item: RssItem, impacts: Map<string, Impact>): NormalizedIncident | null {
  const ref = item.pubDate ?? new Date();
  const d = parseIsDescription(item.description, ref);
  if (d.type !== "incident") return null;
  const id = idFrom(item);
  const resolved = d.updates.find((u) => u.status === "resolved" || u.status === "completed");
  const latest = d.updates.at(-1);
  const status = resolved ? (d.updates.some((u) => u.status === "postmortem") ? "postmortem" : "resolved") : (latest?.status ?? "investigating");
  return {
    externalId: id,
    title: item.title,
    impact: impacts.get(id) ?? "none",
    status,
    startedAt: d.updates[0]?.postedAt && d.updates[0].postedAt < ref ? d.updates[0].postedAt : ref,
    monitoringAt: d.updates.find((u) => u.status === "monitoring")?.postedAt ?? null,
    resolvedAt: resolved?.postedAt ?? null,
    sourceUpdatedAt: latest?.postedAt ?? null,
    url: item.link,
    components: d.components,
    worstComponentStatus: null,
    postmortem: d.updates.some((u) => u.status === "postmortem"),
    // Instatus gives updates no id; the stamp and status are unique within an incident.
    updates: d.updates.map((u) => ({ externalId: `${u.postedAt.toISOString()} ${u.status}`, status: u.status, body: u.body, postedAt: u.postedAt })),
    raw: item,
  };
}

export async function fetchInstatus(base: string, _pageUrl: string, get: Getter): Promise<ProviderSnapshot> {
  const root = base.replace(/\/$/, "");
  // Summary and components are tiny and the feed is read in full, so no ETags.
  const [summaryRes, componentsRes, feedRes] = await Promise.all([
    get(`${root}/summary.json`, { fresh: true }),
    get(`${root}/v2/components.json`, { fresh: true }),
    get(`${root}/history.rss`, { as: "text", fresh: true }),
  ]);
  if (summaryRes.notModified || componentsRes.notModified || feedRes.notModified) return {};

  const s = summaryRes.body as IsSummary;
  const c = componentsRes.body as { components?: IsComponent[] };
  if (!s?.page || !Array.isArray(c?.components)) throw new Error("instatus: unexpected shape");
  if (typeof feedRes.body !== "string") throw new Error("instatus feed: unexpected shape");

  // Group rows ("AU region") also appear as components; keep the leaves.
  const groupNames = new Set(c.components.flatMap((x) => (x.group?.name ? [x.group.name] : [])));
  const components: NormalizedComponent[] = c.components
    .filter((x) => !(groupNames.has(x.name) && !x.group))
    .map((x) => ({ name: x.name, status: mapIsStatus(x.status), group: x.group?.name ?? undefined }));

  const impacts = new Map([...(s.activeIncidents ?? []), ...(s.recentlyResolvedIncidents ?? [])].map((i) => [i.id, mapIsImpact(i.impact)]));
  const incidents = parseRss(feedRes.body).flatMap((item) => normalizeIsItem(item, impacts) ?? []);

  const page = mapIsStatus(s.page.status);
  const worst = worstStatus(components.map((x) => x.status));
  return {
    status: page === "operational" || page === "unknown" ? worst : worstStatus([page, worst]),
    components,
    incidents,
    raw: { summary: s, components: c },
  };
}
