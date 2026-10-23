// "What you need": a short list of things people build on (compute, Postgres,
// storage...) and the regions they run in. Picking some narrows every grade to the
// incidents that could have hit them: /?need=postgres,storage&region=sg
//
// Status pages name things differently, so each need and region is a pattern over
// component names, the title and any regions the provider named. Matching is by
// evidence: an incident is left out only when it names something, and that
// something is not what you picked.
import type { IncidentRow, Snapshot } from "@/lib/data";
import { AREAS, type Area, type Surface } from "@/lib/severity";

export interface Need {
  key: string;
  label: string;
  re: RegExp;
  /** Names that look like this need but aren't (ChatGPT is not the API). */
  not?: RegExp;
  /** Surfaces an incident that names nothing must touch to count for this need. */
  surfaces: Surface[];
}

export const NEEDS: Need[] = [
  {
    key: "compute",
    label: "Compute",
    re: /compute|runtime|\bapps?\b|dyno|container|machines?\b|instances?\b|\bvms?\b|virtual machine|functions?\b|serverless|workers\b|lambda|\bec2\b|cloud run|app engine|kubernetes|\b[gea]ks\b|fargate|droplet|hosting|networking|network\b|ingress|egress|routing|proxy|private network/i,
    surfaces: ["serving"],
  },
  {
    key: "postgres",
    label: "Postgres",
    re: /postgres|database|\bdb\b|\bsql\b|mysql|\brds\b|aurora|cloud sql|spanner|cockroach|vitess|connection pool|pooler|supavisor|pgbouncer|quer(?:y|ies)\b/i,
    surfaces: ["data"],
  },
  { key: "redis", label: "Redis", re: /redis|valkey|\bkv\b|key.?value|memcache|elasticache|memorystore/i, surfaces: ["data"] },
  {
    key: "storage",
    label: "Storage",
    re: /storage|bucket|\bs3\b|\br2\b|blob|object|volumes?\b|\bdisks?\b|\bebs\b|\befs\b|file uploads|files?\b|backups?\b|\bspaces\b/i,
    not: /status page|log storage/i,
    surfaces: ["data"],
  },
  { key: "cdn", label: "CDN & DNS", re: /\bcdn\b|cache|edge|\bdns\b|\bwaf\b|ddos|load balanc|front door|cloudfront|route ?53|ssl|tls|certificate/i, surfaces: ["serving"] },
  {
    key: "deploys",
    label: "Deploys",
    re: /build|deploy|\bci\b|actions|\bgit\b|github|gitlab|\bcli\b|registry|provision|pipeline|dashboard|console|\bapi\b.*(?:backboard|management|control)|control plane/i,
    surfaces: ["ship", "manage"],
  },
  {
    key: "llm",
    label: "LLM API",
    re: /\bapi\b|inference|completion|responses|messages|embedding|models?\b|batch|realtime|fine-?tun|gpt-|claude (?:opus|sonnet|haiku)|llama|gemini|mistral|command/i,
    not: /chatgpt|claude\.ai|claude app|sora|playground|desktop|mobile app|voice mode|codex|claude code|console|dashboard|billing|login/i,
    surfaces: ["serving"],
  },
];

export interface Region {
  key: string;
  label: string;
  re: RegExp;
}

// Asia Pacific as a whole counts for each APAC region; North America for both US ones.
const APAC = /\bapac\b|asia[- ]pacific/;
const NA = /north america/;
export const REGIONS: Region[] = [
  { key: "us-east", label: "US East", re: rx(/us[- ]?east|east ?us|virginia|ashburn|\biad\d?\b|washington,? d\.?c|new york|\bewr\d?\b|\bjfk\b|ohio|\bcmh\b|atlanta|\batl\d?\b|toronto|montreal|\byyz\b/, NA) },
  { key: "us-west", label: "US West", re: rx(/us[- ]?west|west ?us|oregon|california|san francisco|\bsfo\d?\b|\bpdx\d?\b|portland|seattle|\bsea\d\b|los angeles|\blax\d?\b|san jose|\bsjc\d?\b|silicon valley/, NA) },
  { key: "eu", label: "Europe", re: /\beu\b|europe|eu-west|eu-central|eu-north|frankfurt|\bfra\d?\b|london|\blhr\d?\b|dublin|\bdub\d?\b|ireland|amsterdam|\bams\d?\b|paris|\bcdg\d?\b|stockholm|\barn\d?\b|madrid|milan|warsaw|zurich|\bemea\b/i },
  { key: "sg", label: "Singapore", re: rx(/singapore|\bsin\d?\b|\bsgp\b|ap-southeast-1\b|asia-southeast1|southeast ?asia/, APAC) },
  { key: "tokyo", label: "Tokyo", re: rx(/tokyo|japan|osaka|\bnrt\b|\bhnd\d?\b|ap-northeast-1\b|asia-northeast1/, APAC) },
  { key: "sydney", label: "Sydney", re: rx(/sydney|australia|melbourne|\bsyd\d?\b|ap-southeast-2\b|australia-southeast1/, APAC) },
];

// Any region at all, tracked or not: an incident naming one of these is regional.
const ANY_REGION = rx(
  ...REGIONS.map((r) => r.re),
  /\b(?:us|eu|ap|sa|ca|me|af|il|mx)-[a-z]+-\d\b|\b[a-z]+-[a-z]+\d\b|south america|brazil|s[aã]o paulo|\bgru\d?\b|africa|johannesburg|middle east|bahrain|\buae\b|dubai|mumbai|india|\bbom\d?\b|seoul|korea|hong kong|jakarta|taiwan|canada|mexico|chile|israel/,
);

function rx(...parts: RegExp[]): RegExp {
  return new RegExp(parts.map((p) => p.source).join("|"), "i");
}

/** Which needs and whether regions make sense on each category's board. */
const BY_CATEGORY: Record<string, { needs: string[]; regions: boolean }> = {
  hosting: { needs: ["compute", "postgres", "redis", "storage", "cdn", "deploys"], regions: true },
  cloud: { needs: ["compute", "postgres", "redis", "storage", "cdn", "deploys", "llm"], regions: true },
  databases: { needs: ["postgres", "redis", "storage"], regions: true },
  ai: { needs: ["llm"], regions: false },
  devtools: { needs: [], regions: false },
  apis: { needs: [], regions: false },
};

export function choicesFor(category: string): { needs: Need[]; regions: Region[] } {
  const c = BY_CATEGORY[category] ?? { needs: NEEDS.map((n) => n.key), regions: true };
  return { needs: NEEDS.filter((n) => c.needs.includes(n.key)), regions: c.regions ? REGIONS : [] };
}

export interface NeedFilter {
  needs: Need[];
  region: Region | null;
}

export const EMPTY_FILTER: NeedFilter = { needs: [], region: null };
export const isFiltering = (f: NeedFilter) => f.needs.length > 0 || f.region !== null;

/** The filter in a query string, keeping only what the category offers when one is given. */
export function parseFilter(q: { need?: string | string[]; region?: string | string[] }, category?: string): NeedFilter {
  const { needs, regions } = category ? choicesFor(category) : { needs: NEEDS, regions: REGIONS };
  const keys = new Set([q.need ?? []].flat().flatMap((v) => v.toLowerCase().split(/[ ,]/)));
  const region = [q.region ?? []].flat()[0]?.toLowerCase();
  return { needs: needs.filter((n) => keys.has(n.key)), region: regions.find((r) => r.key === region) ?? null };
}

/** The query string for a filter, "" when empty. Keys are [a-z-], so "," stays readable. */
export function filterQuery(f: NeedFilter): string {
  const qs = [...(f.needs.length ? [`need=${f.needs.map((n) => n.key).join(",")}`] : []), ...(f.region ? [`region=${f.region.key}`] : [])];
  return qs.join("&");
}

/** The filter as query params, empty ones left out. */
export function filterParams(f: NeedFilter): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(filterQuery(f)));
}

export const withQuery = (path: string, ...parts: string[]) => {
  const q = parts.filter(Boolean).join("&");
  return q ? `${path}?${q}` : path;
};

export function toggleNeed(f: NeedFilter, key: string): NeedFilter {
  const on = f.needs.some((n) => n.key === key);
  const keys = new Set(f.needs.map((n) => n.key));
  if (on) keys.delete(key);
  else keys.add(key);
  return { ...f, needs: NEEDS.filter((n) => keys.has(n.key)) };
}

const fits = (n: Need, text: string) => n.re.test(text) && !n.not?.test(text);

/** Whether an incident could have hit what was picked. */
export function incidentFits(i: IncidentRow, f: NeedFilter): boolean {
  if (f.region) {
    const where = [...i.components, i.title, ...(i.regions ?? [])];
    // Named a region, but not this one: someone else's outage.
    if (where.some((t) => ANY_REGION.test(t)) && !where.some((t) => f.region!.re.test(t))) return false;
  }
  if (!f.needs.length) return true;
  // Components say what broke; the title only when there are none.
  const named = i.components.length ? i.components : [i.title];
  if (named.some((t) => f.needs.some((n) => fits(n, t)))) return true;
  if (named.some((t) => NEEDS.some((n) => fits(n, t)))) return false;
  if (i.components.length && f.needs.some((n) => fits(n, i.title))) return true;
  // Names nothing we recognise: counts if it touched what these needs run on.
  if (!i.surfaces?.length) return true;
  return f.needs.some((n) => n.surfaces.some((s) => i.surfaces!.includes(s)));
}

/** The area grades the picked needs touch: SHIP only with Deploys, PROD with anything else. Both when none are picked. */
export function areasFor(f: NeedFilter): Area[] {
  if (!f.needs.length) return AREAS;
  return AREAS.filter((a) => f.needs.some((n) => (n.key === "deploys" ? "shipping" : "production") === a));
}

/** The snapshot as if only incidents that could have hit what was picked had happened. */
export function applyFilter(snap: Snapshot, f: NeedFilter): Snapshot {
  if (!isFiltering(f)) return snap;
  return { ...snap, incidents: snap.incidents.filter((i) => incidentFits(i, f)), focus: { areas: areasFor(f) } };
}
