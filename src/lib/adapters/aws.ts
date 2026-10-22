// AWS Health Dashboard, the public JSON behind health.aws.amazon.com/health/status.
//   currentevents   [event] open right now; small, so fetched in full every poll
//   historyevents   { "<service>-<region>": [event] } about a year of past events
// event: { arn, date (epoch s), service: "ec2-us-east-1", service_name, region_name,
//          status: 0-3, summary, event_log: [{ summary, message, status, timestamp }],
//          impacted_services: { "<service>-<region>": { current, max, service_name? } } }
// Status codes: 0 resolved, 1 informational, 2 degradation, 3 disruption.
// AWS serves these gzipped and/or UTF-16; makeGetter's decodeBody copes.
import type { Getter, NormalizedIncident, ProviderSnapshot, Status } from "@/lib/types";
import { impactFromStatus, worstStatus } from "@/lib/status";
import { cloudComponents, cloudStatus, uniq } from "./cloud";

export const AWS_HISTORY_URL = "https://history-events-eu-west-1-prod.s3.amazonaws.com/historyevents.json";

interface AwsLog {
  summary?: string;
  message?: string;
  status?: number | string;
  timestamp?: number | string;
}
interface AwsEvent {
  arn?: string;
  date?: number | string;
  service?: string;
  service_name?: string;
  region_name?: string;
  status?: number | string;
  summary?: string;
  event_log?: AwsLog[];
  impacted_services?: Record<string, { current?: number | string; max?: number | string; service_name?: string }>;
}

export function mapAwsStatus(s: number | string | undefined): Status {
  switch (Number(s)) {
    case 3:
      return "major_outage";
    case 2:
    case 1:
      return "degraded";
    case 0:
      return "operational";
    default:
      return "unknown";
  }
}

// us-east-1, eu-central-2, us-gov-west-1, cn-north-1, ap-southeast-5
const REGION_RE = /(?:^|-)((?:[a-z]{2})(?:-gov|-iso[a-z]?)?-[a-z]+-\d+)$/;

/** "ec2-us-east-1" → ["ec2", "us-east-1"]; "route53" → ["route53", null] (global). */
export function splitServiceKey(key: string): [string, string | null] {
  const m = REGION_RE.exec(key);
  return m ? [key.slice(0, m.index) || key, m[1]] : [key, null];
}

function epoch(v: number | string | undefined): Date | null {
  const n = Number(v);
  if (!v || !Number.isFinite(n) || n <= 0) return null;
  return new Date(n > 1e12 ? n : n * 1000);
}

function eventKey(e: AwsEvent): string {
  return e.arn ?? `${e.service ?? "aws"}:${e.date ?? ""}:${e.summary ?? ""}`;
}

export function normalizeAwsEvent(e: AwsEvent, open: boolean, pageUrl: string): NormalizedIncident {
  const keys = uniq([...(e.service ? [e.service] : []), ...Object.keys(e.impacted_services ?? {})]);
  const split = keys.map(splitServiceKey);
  // A key without a region is a global service (IAM, Route 53, CloudFront).
  const regions = split.length && split.every(([, r]) => r) ? uniq(split.map(([, r]) => r!)).sort() : [];

  const impacted = Object.entries(e.impacted_services ?? {});
  const components = impacted.length
    ? uniq(impacted.map(([k, v]) => v.service_name ?? splitServiceKey(k)[0]))
    : [e.service_name ?? splitServiceKey(e.service ?? "aws")[0]];

  const log = (e.event_log ?? [])
    .map((l, idx) => ({ l, idx, at: epoch(l.timestamp) ?? epoch(e.date) ?? new Date(0) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime() || a.idx - b.idx);
  const updates = log.map(({ l, at }, n) => ({
    externalId: `${at.getTime() / 1000}-${n}`,
    status: open || n < log.length - 1 ? (mapAwsStatus(l.status) === "major_outage" ? "disruption" : "update") : "resolved",
    body: l.message ?? l.summary ?? "",
    postedAt: at,
  }));

  const worst = worstStatus([
    mapAwsStatus(e.status),
    ...log.map(({ l }) => mapAwsStatus(l.status)),
    ...impacted.flatMap(([, v]) => [mapAwsStatus(v.max), mapAwsStatus(v.current)]),
  ]);
  const startedAt = epoch(e.date) ?? updates[0]?.postedAt ?? new Date(0);
  const last = updates.at(-1)?.postedAt ?? null;
  return {
    externalId: eventKey(e),
    title: (e.summary ?? "AWS service event").trim(),
    impact: impactFromStatus(worst),
    status: open ? "investigating" : "resolved",
    startedAt,
    monitoringAt: null,
    resolvedAt: open ? null : last && last > startedAt ? last : startedAt,
    sourceUpdatedAt: last,
    url: pageUrl,
    components,
    regions,
    worstComponentStatus: worst === "operational" || worst === "unknown" ? null : worst,
    postmortem: false,
    updates,
    raw: e,
  };
}

/** historyevents is keyed by service; one event touching several services appears under each. */
function flattenHistory(body: unknown): AwsEvent[] {
  const values = Array.isArray(body) ? body : Object.values(body as Record<string, unknown>);
  const byKey = new Map<string, AwsEvent>();
  for (const v of values.flatMap((x) => (Array.isArray(x) ? x : [x])) as AwsEvent[]) {
    if (!v || typeof v !== "object") continue;
    const k = eventKey(v);
    const prev = byKey.get(k);
    if (!prev) byKey.set(k, { ...v });
    else {
      const own = (e: AwsEvent) => (e.service && !e.impacted_services ? { [e.service]: { service_name: e.service_name } } : {});
      prev.impacted_services = { ...own(prev), ...(prev.impacted_services ?? {}), ...own(v), ...(v.impacted_services ?? {}) };
      if ((v.event_log?.length ?? 0) > (prev.event_log?.length ?? 0)) prev.event_log = v.event_log;
    }
  }
  return [...byKey.values()];
}

export async function fetchAws(base: string, pageUrl: string, get: Getter): Promise<ProviderSnapshot> {
  const [currentRes, historyRes] = await Promise.all([get(base, { fresh: true }), get(AWS_HISTORY_URL, { large: true })]);
  if (currentRes.notModified || !Array.isArray(currentRes.body)) throw new Error("aws currentevents: unexpected shape");
  const current = currentRes.body as AwsEvent[];
  const openKeys = new Set(current.map(eventKey));

  const incidents = current.map((e) => normalizeAwsEvent(e, true, pageUrl));
  if (!historyRes.notModified) {
    const body = historyRes.body;
    if (!body || typeof body !== "object") throw new Error("aws historyevents: unexpected shape");
    for (const e of flattenHistory(body)) {
      if (!openKeys.has(eventKey(e))) incidents.push(normalizeAwsEvent(e, false, pageUrl));
    }
  }
  const open = incidents.filter((i) => !i.resolvedAt);
  return {
    status: cloudStatus(open),
    components: cloudComponents(open),
    // Without history (304) this is only the open events; earlier ones are already stored
    // and the poller closes any open one that dropped off.
    incidents,
    raw: { status: { current } },
  };
}
