// Azure status RSS: GET https://azure.status.microsoft/en-us/status/feed/
// Azure only posts broad incidents publicly (many regions or services, or the portal
// itself); everything narrower goes to affected customers through Service Health.
// The feed lists what is open right now and is empty otherwise, so there is no history
// to backfill and an incident ends when its item drops off (the poller closes it).
//   <item><title>Active - Azure Front Door - Connectivity issues</title><link/><guid/>
//         <description>Impact Statement: Starting at 14:05 UTC on 22 Oct 2026, ...</description>
//         <pubDate>Thu, 22 Oct 2026 14:40:00 Z</pubDate></item>
import { createHash } from "node:crypto";
import type { Getter, NormalizedIncident, ProviderSnapshot, Status } from "@/lib/types";
import { impactFromStatus } from "@/lib/status";
import { cloudComponents, cloudStatus, uniq } from "./cloud";

export interface RssItem {
  title: string;
  link: string | null;
  guid: string | null;
  description: string;
  pubDate: Date | null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  if (!m) return null;
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(m[1]);
  return cdata ? cdata[1] : decodeEntities(m[1]);
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<(br|\/p|\/li|\/div|\/h\d)\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n\n"),
  ).trim();
}

/** A tiny RSS 2.0 reader: enough for a status feed, no dependency. */
export function parseRss(xml: string): RssItem[] {
  if (!/<rss[\s>]/i.test(xml) || !/<channel[\s>]/i.test(xml)) throw new Error("azure feed: unexpected shape");
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(([, body]) => {
    const pub = tag(body, "pubDate");
    const d = pub ? new Date(pub.replace(/ Z$/, " GMT")) : null;
    return {
      title: (tag(body, "title") ?? "").trim(),
      link: tag(body, "link")?.trim() || null,
      guid: tag(body, "guid")?.trim() || null,
      description: tag(body, "description") ?? "",
      pubDate: d && !Number.isNaN(d.getTime()) ? d : null,
    };
  });
}

// Display names as Azure writes them in incident text. Longest first so
// "East US 2" wins over "East US".
const AZURE_REGIONS = [
  "East US 2", "East US 3", "East US", "West US 2", "West US 3", "West US", "Central US", "North Central US", "South Central US", "West Central US",
  "Canada Central", "Canada East", "Brazil South", "Brazil Southeast", "Mexico Central", "Chile Central",
  "North Europe", "West Europe", "UK South", "UK West", "France Central", "France South", "Germany West Central", "Germany North",
  "Switzerland North", "Switzerland West", "Norway East", "Norway West", "Sweden Central", "Poland Central", "Italy North", "Spain Central", "Austria East",
  "East Asia", "Southeast Asia", "Japan East", "Japan West", "Korea Central", "Korea South", "Central India", "South India", "West India",
  "Jio India West", "Australia East", "Australia Southeast", "Australia Central", "New Zealand North", "Indonesia Central", "Malaysia West",
  "UAE North", "UAE Central", "Qatar Central", "Israel Central", "South Africa North", "South Africa West",
].sort((a, b) => b.length - a.length);

export function azureRegions(text: string): string[] {
  let rest = text;
  const found: string[] = [];
  for (const r of AZURE_REGIONS) {
    const re = new RegExp(`\\b${r.replace(/ /g, "\\s+")}\\b`, "gi");
    if (re.test(rest)) {
      found.push(r);
      rest = rest.replace(re, " ");
    }
  }
  // "multiple regions", "all regions", "globally" beat any single name.
  if (/multiple regions|all regions|several regions|global(?:ly)?\b|worldwide/i.test(text)) return [];
  return found.sort();
}

const STATE_RE = /^\s*(active|mitigated|resolved|investigating|monitoring)\s*[-–—:]\s*/i;

function services(text: string): string[] {
  const names = [...text.matchAll(/\b(?:Azure|Microsoft) (?:[A-Z][\w.]*|for|and|of)(?: (?:[A-Z][\w.]*|DB|SQL|AI))*/g)].map((m) => m[0].replace(/ (?:for|and|of)$/, ""));
  return uniq(names.filter((n) => !/^(?:Azure|Microsoft) (?:Status|Service Health|customers?|Support)$/i.test(n))).slice(0, 6);
}

function itemStatus(text: string): Status {
  return /outage|unavailable|unable to|failures?|failing|errors?|could not|cannot|connectivity/i.test(text) ? "partial_outage" : "degraded";
}

/** "Starting at 14:05 UTC on 22 Oct 2026" → Date */
export function azureStart(text: string): Date | null {
  const m = /starting (?:at|from)?\s*(\d{1,2}:\d{2})\s*UTC on\s*(\d{1,2}\s+\w+\s+\d{4})/i.exec(text);
  if (!m) return null;
  const d = new Date(`${m[2]} ${m[1]} UTC`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function normalizeAzureItem(item: RssItem, pageUrl: string, now: Date): NormalizedIncident {
  const body = stripHtml(item.description);
  const state = STATE_RE.exec(item.title)?.[1].toLowerCase() ?? "active";
  const title = item.title.replace(STATE_RE, "").trim() || "Azure incident";
  const text = `${title}\n${body}`;
  const worst = itemStatus(text);
  const posted = item.pubDate ?? now;
  const startedAt = azureStart(body) ?? posted;
  const mitigated = state === "mitigated" || state === "resolved" || state === "monitoring";
  return {
    externalId: item.guid ?? item.link ?? title,
    title,
    impact: impactFromStatus(worst),
    status: mitigated ? "monitoring" : "investigating",
    startedAt,
    monitoringAt: mitigated ? posted : null,
    resolvedAt: null,
    sourceUpdatedAt: item.pubDate,
    url: item.link ?? pageUrl,
    components: services(text),
    regions: azureRegions(text),
    worstComponentStatus: worst,
    postmortem: false,
    // Keyed by content, so a feed without pubDate doesn't add an update every poll.
    updates: [{ externalId: createHash("sha256").update(`${state}\n${body}`).digest("hex").slice(0, 16), status: state, body, postedAt: posted }],
    raw: item,
  };
}

export async function fetchAzure(base: string, pageUrl: string, get: Getter): Promise<ProviderSnapshot> {
  const res = await get(base, { as: "text" });
  if (res.notModified) return {};
  if (typeof res.body !== "string") throw new Error("azure feed: unexpected shape");
  const items = parseRss(res.body);
  const incidents = items.map((i) => normalizeAzureItem(i, pageUrl, new Date()));
  // A mitigated item stays in the feed for a while; it no longer counts as down.
  const active = incidents.filter((i) => !i.monitoringAt);
  return {
    status: cloudStatus(active),
    components: cloudComponents(active),
    incidents,
    raw: { status: { items } },
  };
}
