// Where an incident hit, as points on a map. Status pages name places many ways:
// cloud region codes (us-east-1, asia-southeast1), Azure display names ("East US 2"),
// a CDN city with its airport code ("Accra, Ghana - (ACC)"), a region code with a
// city ("iad1 - Washington, D.C., USA") or a city in brackets ("Asia Southeast
// (Singapore)"). Each resolves to an airport, whose coordinates come from the
// generated table in geo/airports.ts. A country with no city ("to Claro Brazil",
// carrier incidents) pins to a point inside it, from geo/countries.ts. Broad areas
// ("Europe", "APAC") are not places: they stay off the map and are only counted.
import { AIRPORTS } from "@/lib/geo/airports";
import { COUNTRIES } from "@/lib/geo/countries";
import type { IncidentRow } from "@/lib/data";
import { shownEnd, unionMinutes } from "@/lib/grading";
import { gradeInput, tierOf } from "@/lib/views";

export interface Place {
  /** The airport the place resolves to; two names for one spot share it. */
  key: string;
  /** What to call it: the city or area. */
  name: string;
  /** As the provider wrote it ("us-east-1", "iad1", "East US 2"). */
  label: string;
  lat: number;
  lon: number;
}

let airports: Map<string, [number, number]> | null = null;
function airport(code: string): [number, number] | null {
  if (!airports) {
    airports = new Map();
    for (const e of AIRPORTS.split(";")) {
      const [lat, lon] = e.slice(3).split(",").map(Number);
      airports.set(e.slice(0, 3), [lat, lon]);
    }
  }
  return airports.get(code.toUpperCase()) ?? null;
}

// [label, airport] per cloud region code.
const CLOUD: Record<string, [string, string]> = {
  // AWS
  "us-east-1": ["N. Virginia", "IAD"], "us-east-2": ["Ohio", "CMH"], "us-west-1": ["N. California", "SFO"], "us-west-2": ["Oregon", "PDX"],
  "us-gov-east-1": ["GovCloud East", "CMH"], "us-gov-west-1": ["GovCloud West", "PDX"],
  "ca-central-1": ["Montréal", "YUL"], "ca-west-1": ["Calgary", "YYC"], "mx-central-1": ["Querétaro", "QRO"], "sa-east-1": ["São Paulo", "GRU"],
  "eu-west-1": ["Ireland", "DUB"], "eu-west-2": ["London", "LHR"], "eu-west-3": ["Paris", "CDG"], "eu-central-1": ["Frankfurt", "FRA"],
  "eu-central-2": ["Zurich", "ZRH"], "eu-north-1": ["Stockholm", "ARN"], "eu-south-1": ["Milan", "MXP"], "eu-south-2": ["Spain", "MAD"],
  "il-central-1": ["Tel Aviv", "TLV"], "me-south-1": ["Bahrain", "BAH"], "me-central-1": ["UAE", "DXB"], "af-south-1": ["Cape Town", "CPT"],
  "ap-south-1": ["Mumbai", "BOM"], "ap-south-2": ["Hyderabad", "HYD"], "ap-east-1": ["Hong Kong", "HKG"], "ap-east-2": ["Taipei", "TPE"],
  "ap-southeast-1": ["Singapore", "SIN"], "ap-southeast-2": ["Sydney", "SYD"], "ap-southeast-3": ["Jakarta", "CGK"], "ap-southeast-4": ["Melbourne", "MEL"],
  "ap-southeast-5": ["Malaysia", "KUL"], "ap-southeast-6": ["New Zealand", "AKL"], "ap-southeast-7": ["Thailand", "BKK"],
  "ap-northeast-1": ["Tokyo", "NRT"], "ap-northeast-2": ["Seoul", "ICN"], "ap-northeast-3": ["Osaka", "KIX"],
  // Google Cloud
  "us-central1": ["Iowa", "DSM"], "us-east1": ["South Carolina", "CHS"], "us-east4": ["N. Virginia", "IAD"], "us-east5": ["Columbus", "CMH"],
  "us-south1": ["Dallas", "DFW"], "us-west1": ["Oregon", "PDX"], "us-west2": ["Los Angeles", "LAX"], "us-west3": ["Salt Lake City", "SLC"],
  "us-west4": ["Las Vegas", "LAS"], "northamerica-northeast1": ["Montréal", "YUL"], "northamerica-northeast2": ["Toronto", "YYZ"],
  "northamerica-south1": ["Querétaro", "QRO"], "southamerica-east1": ["São Paulo", "GRU"], "southamerica-west1": ["Santiago", "SCL"],
  "europe-west1": ["Belgium", "BRU"], "europe-west2": ["London", "LHR"], "europe-west3": ["Frankfurt", "FRA"], "europe-west4": ["Netherlands", "AMS"],
  "europe-west6": ["Zurich", "ZRH"], "europe-west8": ["Milan", "MXP"], "europe-west9": ["Paris", "CDG"], "europe-west10": ["Berlin", "BER"],
  "europe-west12": ["Turin", "TRN"], "europe-north1": ["Finland", "HEL"], "europe-north2": ["Stockholm", "ARN"], "europe-central2": ["Warsaw", "WAW"],
  "europe-southwest1": ["Madrid", "MAD"], "me-west1": ["Tel Aviv", "TLV"], "me-central1": ["Doha", "DOH"], "me-central2": ["Dammam", "DMM"],
  "africa-south1": ["Johannesburg", "JNB"], "asia-east1": ["Taiwan", "TPE"], "asia-east2": ["Hong Kong", "HKG"], "asia-northeast1": ["Tokyo", "NRT"],
  "asia-northeast2": ["Osaka", "KIX"], "asia-northeast3": ["Seoul", "ICN"], "asia-south1": ["Mumbai", "BOM"], "asia-south2": ["Delhi", "DEL"],
  "asia-southeast1": ["Singapore", "SIN"], "asia-southeast2": ["Jakarta", "CGK"], "australia-southeast1": ["Sydney", "SYD"],
  "australia-southeast2": ["Melbourne", "MEL"],
};

// Azure display names, longest first so "East US 2" wins over "East US".
const AZURE: [string, string][] = (
  [
    ["East US 2", "IAD"], ["East US 3", "ATL"], ["East US", "IAD"], ["West US 2", "SEA"], ["West US 3", "PHX"], ["West US", "SFO"],
    ["North Central US", "ORD"], ["South Central US", "SAT"], ["West Central US", "DEN"], ["Central US", "DSM"],
    ["Canada Central", "YYZ"], ["Canada East", "YQB"], ["Brazil Southeast", "GIG"], ["Brazil South", "GRU"], ["Mexico Central", "QRO"],
    ["Chile Central", "SCL"], ["North Europe", "DUB"], ["West Europe", "AMS"], ["UK South", "LHR"], ["UK West", "CWL"],
    ["France Central", "CDG"], ["France South", "MRS"], ["Germany West Central", "FRA"], ["Germany North", "BER"],
    ["Switzerland North", "ZRH"], ["Switzerland West", "GVA"], ["Norway East", "OSL"], ["Norway West", "SVG"], ["Sweden Central", "ARN"],
    ["Poland Central", "WAW"], ["Italy North", "MXP"], ["Spain Central", "MAD"], ["Austria East", "VIE"], ["East Asia", "HKG"],
    ["Southeast Asia", "SIN"], ["Japan East", "NRT"], ["Japan West", "KIX"], ["Korea Central", "ICN"], ["Korea South", "PUS"],
    ["Central India", "PNQ"], ["South India", "MAA"], ["Jio India West", "BOM"], ["West India", "BOM"], ["Australia Southeast", "MEL"],
    ["Australia Central", "CBR"], ["Australia East", "SYD"], ["New Zealand North", "AKL"], ["Indonesia Central", "CGK"],
    ["Malaysia West", "KUL"], ["UAE North", "DXB"], ["UAE Central", "AUH"], ["Qatar Central", "DOH"], ["Israel Central", "TLV"],
    ["South Africa North", "JNB"], ["South Africa West", "CPT"],
  ] as [string, string][]
).sort((a, b) => b[0].length - a[0].length);
const AZURE_RE = new RegExp(`\\b(${AZURE.map(([n]) => n.replace(/ /g, "\\s+")).join("|")})\\b`, "i");

// Cities and states that cloud and hosting pages name, with the airport to pin them to.
// Specific places only; a word that is also a common noun or a country-wide area stays out.
const CITIES: [RegExp, string, string][] = [
  [/singapore/i, "Singapore", "SIN"], [/tokyo/i, "Tokyo", "NRT"], [/osaka/i, "Osaka", "KIX"], [/seoul/i, "Seoul", "ICN"],
  [/hong kong/i, "Hong Kong", "HKG"], [/taipei|taiwan/i, "Taipei", "TPE"], [/mumbai/i, "Mumbai", "BOM"], [/bangalore|bengaluru/i, "Bangalore", "BLR"],
  [/chennai/i, "Chennai", "MAA"], [/delhi/i, "Delhi", "DEL"], [/hyderabad/i, "Hyderabad", "HYD"], [/jakarta/i, "Jakarta", "CGK"],
  [/sydney/i, "Sydney", "SYD"], [/melbourne/i, "Melbourne", "MEL"], [/auckland/i, "Auckland", "AKL"],
  [/frankfurt/i, "Frankfurt", "FRA"], [/amsterdam/i, "Amsterdam", "AMS"], [/london/i, "London", "LHR"], [/paris/i, "Paris", "CDG"],
  [/dublin/i, "Dublin", "DUB"], [/stockholm/i, "Stockholm", "ARN"], [/madrid/i, "Madrid", "MAD"], [/milan/i, "Milan", "MXP"],
  [/warsaw/i, "Warsaw", "WAW"], [/zurich|zürich/i, "Zurich", "ZRH"], [/helsinki/i, "Helsinki", "HEL"], [/brussels/i, "Brussels", "BRU"],
  [/vienna/i, "Vienna", "VIE"], [/oslo/i, "Oslo", "OSL"], [/copenhagen/i, "Copenhagen", "CPH"], [/berlin/i, "Berlin", "BER"],
  [/s[aã]o paulo/i, "São Paulo", "GRU"], [/santiago/i, "Santiago", "SCL"], [/bogot[aá]/i, "Bogotá", "BOG"], [/mexico city/i, "Mexico City", "MEX"],
  [/toronto/i, "Toronto", "YYZ"], [/montr[eé]al/i, "Montréal", "YUL"], [/vancouver/i, "Vancouver", "YVR"],
  [/johannesburg/i, "Johannesburg", "JNB"], [/cape town/i, "Cape Town", "CPT"], [/dubai/i, "Dubai", "DXB"], [/tel aviv/i, "Tel Aviv", "TLV"],
  [/bahrain/i, "Bahrain", "BAH"], [/doha/i, "Doha", "DOH"], [/ashburn|virginia/i, "Virginia", "IAD"], [/washington,? d\.?c/i, "Washington, D.C.", "IAD"],
  [/ohio|columbus/i, "Ohio", "CMH"], [/oregon|portland/i, "Oregon", "PDX"], [/san francisco|silicon valley|california/i, "California", "SFO"],
  [/san jose/i, "San Jose", "SJC"], [/los angeles/i, "Los Angeles", "LAX"], [/seattle/i, "Seattle", "SEA"], [/chicago/i, "Chicago", "ORD"],
  [/dallas/i, "Dallas", "DFW"], [/atlanta/i, "Atlanta", "ATL"], [/miami/i, "Miami", "MIA"], [/new york|\bnyc\b|new jersey|secaucus|newark/i, "New York", "EWR"],
  [/\biowa\b/i, "Iowa", "DSM"], [/denver/i, "Denver", "DEN"], [/salt lake/i, "Salt Lake City", "SLC"],
  [/las vegas/i, "Las Vegas", "LAS"],
].map(([re, label, code]) => [new RegExp(`\\b(?:${(re as RegExp).source})\\b`, "i"), label as string, code as string]);

// City codes some pages use that aren't airport codes (DigitalOcean's NYC1, SGP1).
const CODE_ALIAS: Record<string, string> = { NYC: "EWR", SGP: "SIN", LON: "LHR", TOR: "YYZ", WAS: "IAD", CHI: "ORD", TYO: "NRT", PAR: "CDG" };

const AWS_GCP_RE = /\b(?:(?:us|eu|ap|sa|ca|me|af|il|mx)(?:-gov)?-[a-z]+-\d|[a-z]+-[a-z]+\d{1,2})\b/gi;
// "Accra, Ghana - (ACC)". Needs the " - ": "Digital Asset Management (DAM)" is not Damascus.
const BRACKET_CODE_RE = /\s-\s*\(([A-Z]{3})\)\s*$/;
// "iad1 - Washington, D.C., USA", or the code alone ("NYC1"). Not "GPT4 errors".
const LEAD_CODE_RE = /^([a-z]{3})\d{1,2}(?:\s+-\s+([^,]+).*)?$/i;
// Vercel-style titles: "Elevated errors in iad1".
const IN_CODE_RE = /\bin ([a-z]{3})\d\b/g;

// One name per airport, so us-east-1, iad1 and "East US" all read as one place.
const NAME_BY_CODE = new Map<string, string>();
for (const [code, name] of [
  ...CITIES.map(([, name, code]) => [code, name]),
  ...Object.values(CLOUD).map(([name, code]) => [code, name]),
  ["HND", "Tokyo"], ["CLE", "Cleveland"], ["KUL", "Kuala Lumpur"], ["BKK", "Bangkok"], ["PUS", "Busan"], ["PNQ", "Pune"],
  ["SEA", "Seattle"], ["SAT", "San Antonio"], ["YQB", "Quebec City"], ["GIG", "Rio de Janeiro"], ["CWL", "Cardiff"],
  ["MRS", "Marseille"], ["SVG", "Stavanger"], ["CBR", "Canberra"], ["AUH", "Abu Dhabi"], ["GVA", "Geneva"],
]) if (!NAME_BY_CODE.has(code)) NAME_BY_CODE.set(code, name);

function at(code: string, label: string): Place | null {
  const c = CODE_ALIAS[code.toUpperCase()] ?? code.toUpperCase();
  const ll = airport(c);
  return ll ? { key: c, name: NAME_BY_CODE.get(c) ?? label, label, lat: ll[0], lon: ll[1] } : null;
}

// Other names pages use for a country, as Natural Earth spells it in geo/countries.ts.
// "UK" and "USA" match only in capitals; "US" not at all ("contact us").
const COUNTRY_ALIAS: Record<string, string> = {
  "united states of america": "United States", usa: "United States", "u.s.": "United States", uk: "United Kingdom",
  "great britain": "United Kingdom", "northern ireland": "United Kingdom", england: "United Kingdom", scotland: "United Kingdom",
  wales: "United Kingdom", holland: "Netherlands", "the netherlands": "Netherlands", "czech republic": "Czechia", türkiye: "Turkey",
  turkiye: "Turkey", "ivory coast": "Côte d'Ivoire", "cote d'ivoire": "Côte d'Ivoire", "republic of korea": "South Korea", korea: "South Korea",
  "russian federation": "Russia", "viet nam": "Vietnam", "democratic republic of the congo": "DR Congo", "republic of the congo": "Congo",
  swaziland: "Eswatini", "cape verde": "Cabo Verde", burma: "Myanmar", "east timor": "Timor-Leste", uae: "United Arab Emirates",
  "hong kong sar": "Hong Kong", macau: "Macao", "trinidad & tobago": "Trinidad and Tobago", "bosnia & herzegovina": "Bosnia and Herzegovina",
  "antigua & barbuda": "Antigua and Barbuda", "saint kitts & nevis": "Saint Kitts and Nevis", "st. lucia": "Saint Lucia", "st lucia": "Saint Lucia",
};
const CASED_ALIAS = new Set(["uk", "usa", "uae"]);

let countries: Map<string, { name: string; lat: number; lon: number }> | null = null;
let countryRegex: RegExp | null = null;
const CASED_RE = /(?<![\w-])(?:UK|USA|UAE)(?![\w-])/g;
function countryTable() {
  if (!countries) {
    countries = new Map();
    for (const e of COUNTRIES.split(";")) {
      const [name, ll] = e.split("|");
      const [lat, lon] = ll.split(",").map(Number);
      countries.set(name.toLowerCase(), { name, lat, lon });
    }
  }
  return countries;
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
function countryRe(): RegExp {
  if (!countryRegex) {
    // Longest first, so "Papua New Guinea" wins over "Guinea" and "South Sudan" over "Sudan".
    const names = [...countryTable().keys(), ...Object.keys(COUNTRY_ALIAS).filter((a) => !CASED_ALIAS.has(a))].sort((a, b) => b.length - a.length);
    // "New Mexico" is a state.
    countryRegex = new RegExp(`(?<![\\w-])(?<!New\\s)(?:${names.map(esc).join("|")})(?![\\w-])`, "gi");
  }
  return countryRegex;
}
/** Countries are keyed by name ("costa-rica"), so they never collide with an airport code. */
const countryKey = (name: string) => name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
function country(text: string): Place | null {
  const t = text.replace(/\s+/g, " ").toLowerCase();
  const c = countryTable().get(COUNTRY_ALIAS[t]?.toLowerCase() ?? t);
  return c ? { key: countryKey(c.name), name: c.name, label: text.trim(), lat: c.lat, lon: c.lon } : null;
}
let countryByKey: Map<string, string> | null = null;
function countryName(key: string): string | undefined {
  countryByKey ??= new Map([...countryTable().values()].map((c) => [countryKey(c.name), c.name]));
  return countryByKey.get(key);
}

// Broad areas: counted under the map, never pinned. Longest first.
const AREAS: [RegExp, string][] = (
  [
    ["latin america|latam", "Latin America"], ["south america", "South America"], ["central america", "Central America"],
    ["north america|\\bnoram\\b", "North America"], ["middle east (?:&|and) africa|\\bmea\\b", "Middle East & Africa"],
    ["\\bemea\\b", "EMEA"], ["middle east", "Middle East"], ["asia[- ]pacific|\\bapac\\b|\\bapj\\b", "Asia Pacific"],
    ["europe|\\beu\\b(?!-)", "Europe"], ["africa", "Africa"], ["oceania", "Oceania"], ["caribbean", "Caribbean"], ["\\basia\\b", "Asia"],
  ] as [string, string][]
).map(([re, name]) => [new RegExp(re, "i"), name]);

/** The broad area a name falls in ("CARRIER NETWORK - SMS, APAC" → "Asia Pacific"), if any. */
export function areaIn(name: string): string | null {
  for (const [re, area] of AREAS) if (re.test(name)) return area;
  return null;
}

const memo = new Map<string, Place[]>();

/** Every specific place one name refers to; empty for global or unnamed. */
export function placesIn(name: string): Place[] {
  const hit = memo.get(name);
  if (hit) return hit;
  const out: Place[] = [];
  const add = (p: Place | null) => {
    if (p && !out.some((o) => o.key === p.key)) out.push(p);
  };

  for (const m of name.matchAll(AWS_GCP_RE)) {
    const r = CLOUD[m[0].toLowerCase()];
    if (r) add(at(r[1], m[0].toLowerCase()));
  }
  const az = AZURE_RE.exec(name);
  if (az) {
    const [label, code] = AZURE.find(([n]) => n.toLowerCase() === az[1].replace(/\s+/g, " ").toLowerCase())!;
    add(at(code, label));
  }
  if (!out.length) {
    // "North America - Ashburn - (IAD)" or "Accra, Ghana - (ACC)": the city is the last part before the code.
    const br = BRACKET_CODE_RE.exec(name);
    const lead = LEAD_CODE_RE.exec(name);
    if (br) add(at(br[1], name.replace(BRACKET_CODE_RE, "").split(" - ").pop()!.split(",")[0].trim()));
    else if (lead) add(at(lead[1], lead[2]?.trim() || name.trim()));
    else for (const m of name.matchAll(IN_CODE_RE)) add(at(m[1], m[0].slice(3)));
  }
  if (!out.length) for (const [re, label, code] of CITIES) if (re.test(name)) add(at(code, label));
  if (!out.length) for (const m of [...name.matchAll(countryRe()), ...name.matchAll(CASED_RE)].sort((a, b) => a.index - b.index)) add(country(m[0]));

  if (memo.size > 20_000) memo.clear();
  memo.set(name, out);
  return out;
}

/** Where an incident hit: the regions the provider named, else its components and title. */
export function incidentPlaces(i: Pick<IncidentRow, "regions" | "components" | "title">): Place[] {
  const names = i.regions?.length ? i.regions : [...i.components, i.title];
  const out = new Map<string, Place>();
  for (const n of names) for (const p of placesIn(n)) if (!out.has(p.key)) out.set(p.key, p);
  return [...out.values()];
}

/** Broad areas an incident names, for one that names no place. */
export function incidentAreas(i: Pick<IncidentRow, "regions" | "components" | "title">): string[] {
  const names = i.regions?.length ? i.regions : [...i.components, i.title];
  return [...new Set(names.map(areaIn).filter((a): a is string => !!a))];
}

export interface MapPoint extends Omit<Place, "label"> {
  /** Other names the providers used for it, most used first. */
  aka: string[];
  incidents: number;
  /** Something open or broken there right now. */
  now: boolean;
  providers: string[];
}

export interface OutageMap {
  points: MapPoint[];
  /** Incidents with at least one place, and without any. */
  placed: number;
  unplaced: number;
  /** Unplaced incidents by the broad area they name, busiest first. */
  areas: { name: string; incidents: number }[];
}

export interface MapItem {
  places: Place[];
  provider: string;
  now: boolean;
  /** False for a broken component: a place, but not an incident to count. */
  incident?: boolean;
  /** Broad areas named, used only when no place is. */
  areas?: string[];
}

/** Folds incidents (and broken components) into one point per place, busiest first. */
export function outageMap(items: MapItem[]): OutageMap {
  const points = new Map<string, Omit<MapPoint, "aka"> & { labels: Map<string, number> }>();
  let placed = 0;
  let unplaced = 0;
  const areas = new Map<string, number>();
  for (const it of items) {
    const counts = it.incident !== false;
    if (!it.places.length) {
      if (counts) {
        unplaced++;
        for (const a of it.areas ?? []) areas.set(a, (areas.get(a) ?? 0) + 1);
      }
      continue;
    }
    if (counts) placed++;
    for (const p of it.places) {
      const { label, ...place } = p;
      const pt = points.get(p.key) ?? { ...place, incidents: 0, now: false, providers: [] as string[], labels: new Map<string, number>() };
      if (counts) pt.incidents++;
      pt.now ||= it.now;
      if (!pt.providers.includes(it.provider)) pt.providers.push(it.provider);
      pt.labels.set(label, (pt.labels.get(label) ?? 0) + 1);
      points.set(p.key, pt);
    }
  }
  return {
    points: [...points.values()]
      .map(({ labels, ...pt }) => ({
        ...pt,
        aka: [...labels.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l).filter((l) => l !== pt.name),
      }))
      .sort((a, b) => Number(b.now) - Number(a.now) || b.incidents - a.incidents || a.name.localeCompare(b.name)),
    placed,
    unplaced,
    areas: [...areas.entries()].map(([name, incidents]) => ({ name, incidents })).sort((a, b) => b.incidents - a.incidents || a.name.localeCompare(b.name)),
  };
}

/** The display name for an airport key, for a place picked by URL. */
export function placeName(key: string): string {
  return NAME_BY_CODE.get(key) ?? countryName(key) ?? key;
}

/** An airport code ("IAD") or a country ("costa-rica"). */
export const isPlaceKey = (s: string | undefined): s is string => /^(?:[A-Z]{3}|[a-z]+(?:-[a-z]+)*)$/.test(s ?? "") && (/^[A-Z]/.test(s!) || !!countryName(s!));

export interface PlaceTime {
  key: string;
  name: string;
  /** Minutes with a Sev 1 or 2 open that names this place, any provider; overlaps count once. */
  minutes: number;
  incidents: number;
  providers: string[];
}

/** Places ranked by Sev 1–2 time over the window, worst first. */
export function placeBoard(list: IncidentRow[], now: number, days: number, nameOf: (providerId: number) => string): PlaceTime[] {
  const from = now - days * 86_400_000;
  const by = new Map<string, { name: string; spans: [number, number][]; providers: Set<string> }>();
  for (const i of list) {
    const t = tierOf(i);
    if (t < 1 || t > 2) continue;
    const span: [number, number] = [i.startedAt, shownEnd(gradeInput(i), now)];
    if (span[1] <= from) continue;
    for (const p of incidentPlaces(i)) {
      const e = by.get(p.key) ?? { name: p.name, spans: [], providers: new Set<string>() };
      e.spans.push(span);
      e.providers.add(nameOf(i.providerId));
      by.set(p.key, e);
    }
  }
  return [...by.entries()]
    .map(([key, e]) => ({ key, name: e.name, minutes: unionMinutes(e.spans, from, now), incidents: e.spans.length, providers: [...e.providers] }))
    .filter((x) => x.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
}
