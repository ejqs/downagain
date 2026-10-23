// Our own severity tiers, graded by one question: how badly did this hurt the
// people building on this provider?
//
//   Sev 1 · Lights out  prod serving or data down, or data loss         weight 10
//   Sev 2 · Bleeding    prod degraded; floor for any security incident  weight 4
//   Sev 3 · Can't ship  can't deploy, build or manage it (CI, CLI,       weight 1
//                       dashboard, auth, billing down)
//   Sev 4 · Papercut    docs, status page, a slow dashboard               weight 0.2
//   0     · Not counted maintenance inside its window                    weight 0
//
// Two area grades sit beside the overall one, split by who feels it:
//   PROD  your end users are hit (serving, data)
//   SHIP  you can't deploy, build or manage the service (ship, and manage
//         when it actually blocks you). Papercuts only touch the overall grade.
//
// Bump CLASSIFIER_VERSION whenever these rules change. The next polls regrade
// every stored incident (see regradeStale), or run `bun run regrade`.
import type { Status } from "@/lib/types";
import type { Impact } from "@/db/schema";

export const CLASSIFIER_VERSION = 6;

// manage: dashboard, console, auth, billing. peripheral: docs, status page, consumer apps.
export type Surface = "serving" | "data" | "ship" | "manage" | "peripheral";
export type Area = "production" | "shipping";
export const AREAS: Area[] = ["production", "shipping"];
export type Tier = 0 | 1 | 2 | 3 | 4;
type Level = "minor" | "partial" | "full";

export const TIER_NAMES: Record<number, string> = {
  0: "Not counted",
  1: "Lights out",
  2: "Bleeding",
  3: "Can't ship",
  4: "Papercut",
};
export const TIER_BLURB: Record<number, string> = {
  1: "Prod site, API or database down, or data loss",
  2: "Prod degraded or partly down",
  3: "Can't deploy, build or manage it",
  4: "Docs, status page, slow dashboard",
};
export const TIER_WEIGHT: Record<number, number> = { 0: 0, 1: 10, 2: 4, 3: 1, 4: 0.2 };
export const SECURITY_PENALTY = 600; // same as an hour of Sev 1

// Blast radius. The tier says how bad it was for whoever was hit; scope says how
// many were hit, and scales the penalty points. A provider with hundreds of
// locations that reports every local blip shouldn't score like one that went
// down everywhere. Unclear counts in full: no discount without evidence.
export type Scope = "global" | "regional" | "local" | "subset" | "single" | "unclear";
export const SCOPE_WEIGHT: Record<Scope, number> = { global: 1, unclear: 1, regional: 0.3, subset: 0.3, single: 0.1, local: 0.1 };
export const SCOPE_BLURB: Record<Scope, string> = {
  global: "Most customers or regions",
  unclear: "The provider didn't say",
  regional: "One region, country or a few locations",
  subset: "One plan, or a small share of customers",
  single: "One model, endpoint or add-on among many",
  local: "One data centre or point of presence",
};
export function scopeWeight(scope: string | null | undefined): number {
  return SCOPE_WEIGHT[scope as Scope] ?? 1;
}
/** Best tier an incident confined to one cloud region can get (data loss excepted). */
export const REGIONAL_FLOOR: Tier = 2;

/** Which area grade an affected surface counts against, if any. A papercut counts only overall. */
export function areaFor(surface: Surface, tier: number): Area | null {
  if (surface === "serving" || surface === "data") return "production";
  if (surface === "ship") return "shipping";
  if (surface === "manage" && tier <= 3) return "shipping";
  return null;
}
export const AREA_LABEL: Record<Area, string> = {
  production: "Production",
  shipping: "Shipping",
};
export const AREA_SHORT: Record<Area, string> = { production: "PROD", shipping: "SHIP" };
export const AREA_BLURB: Record<Area, string> = {
  production: "Your users are hit: apps, APIs, databases, inference",
  shipping: "You can't deploy, build or manage: CI, CLI, dashboard, auth, billing",
};

// Order matters: the first rule that matches wins.
const SURFACE_RULES: [Surface, RegExp][] = [
  ["peripheral", /invoice|docs|documentation|support|status page|community|marketing|website|e-?mail|notification|analytics|usage|metrics|chatgpt|sora|playground|web app|mobile app|claude\.ai|claude app|desktop|voice mode|gpts|deep research|search|codex|compliance/i],
  ["manage", /dashboard|console|billing|payment|subscription|sign[- ]?up|signup|sign[- ]?in|login|log[- ]in|auth|account|api keys?|team|organi[sz]ation|settings/i],
  ["data", /database|postgres|mysql|mongo|redis|\bkv\b|key.?value|storage|volume|blob|bucket|backup|object|files?\b|file uploads|kafka|queue/i],
  ["ship", /build|deploy|\bci\b|actions|git|\bcli\b|provision|machines api|template|webhook|logs?\b|log stream|registry|image registry|domains? management|certificate|fine-?tun|training|batch|cron|preview/i],
  ["serving", /edge|cdn|dns|network|runtime|function|serverless|compute|\bapps?\b|hosting|customer applications|proxy|routing|load balanc|inference|completion|messages|responses|embedding|realtime|moderation|audio|images?\b|model|agents|\bapi\b|ingress|egress|websocket|static|region|us-|eu-|asia|ap-|\b[a-z]{3}\d?\s*[-–—]\s*[a-z]/i],
];

const SECURITY_RE = /\bsecurity\b|vulnerab|unauthori[sz]ed|credential|token leak|leaked|compromise|\bcve-\d|exposed|breach|malicious|supply.?chain/i;
const DATA_LOSS_RE = /data loss|lost data|data (?:was|were|has been) lost|customer data (?:was |were )?(?:exposed|accessed)|data breach|irrecoverabl/i;
const MAINTENANCE_RE = /scheduled maintenance|planned maintenance/i;
// Text that says customers were blocked from shipping or managing, whatever the component.
const BLOCKED_RE = /(?:unable|can(?:no|')t|could not|couldn't|fail(?:ed|ing|s)?) to (?:deploy|build|push|log ?in|sign ?in|update|create|scale|configure|change)|deploy(?:s|ments)? (?:are |were )?(?:failing|blocked|stuck|delayed)|accounts? (?:were |was |are |is )?(?:suspended|frozen|locked)/i;

// For hosting providers a bare "API" is the control plane (what the dashboard and
// CLI talk to), not the customer's running app.
const HOSTING_CONTROL_PLANE_RE = /\bapi\b|backboard|control plane/i;
const HOSTING_SERVING_RE = /edge|runtime|function|customer|ingress|egress|proxy|network/i;

// Cloud product names ("Amazon Elastic Compute Cloud", "Cloud Spanner", "Azure Front
// Door") mostly miss the generic rules, so clouds get their own list first.
// IAM and identity count as serving: when sign-in breaks, running workloads break.
const CLOUD_SURFACE_RULES: [Surface, RegExp][] = [
  ["peripheral", /support|marketplace|health dashboard|personal health|documentation/i],
  ["manage", /console|portal|billing|cost (?:explorer|management)|resource manager|\barm\b/i],
  ["data", /\bsql\b|spanner|bigtable|bigquery|firestore|datastore|dynamo|aurora|\brds\b|relational database|\bs3\b|simple storage|elasticache|memorystore|cosmos|blob|\bdisks?\b|\bebs\b|\befs\b|filestore|file storage|storage|database|pub\/?sub|\bsqs\b|\bsns\b|kinesis|event hubs|service bus|redshift|backup/i],
  ["ship", /cloud build|codebuild|codepipeline|codedeploy|cloudformation|deployment manager|artifact registry|container registry|\becr\b|devops|cloud shell|provisioning|quota/i],
  ["serving", /compute|\bec2\b|lambda|functions?|cloud run|app engine|kubernetes|\b[gea]ks\b|\becs\b|fargate|load balanc|\belb\b|cloudfront|\bcdn\b|dns|route ?53|network|\bvpc\b|interconnect|api gateway|apigee|identity|\biam\b|\bsts\b|cognito|entra|active directory|vertex|bedrock|openai|gemini|virtual machines?|app service|front door|multiple (?:products|services)/i],
];

// Database providers: queries, connections and the data APIs a customer's own users
// hit are PROD; creating databases, branching, migrations and the management API
// are SHIP. Checked before the generic rules, which would call "Database
// Operations" or "New database creation" data. Auth here is the end-user auth
// some providers serve (Supabase), so it is set per provider, not by these rules.
const DATABASE_SURFACE_RULES: [Surface, RegExp][] = [
  ["peripheral", /docs|documentation|support|status page|community|marketing|website|telemetry|insights|metrics|analytics|charts|e-?mail|notification/i],
  ["ship", /branch|migration|schema|deploy|database operations|provision|creat(?:e|ion)|scal(?:e|ing)|restore|pause|lifecycle|backups?|management api|mgmt|admin api|\bcli\b|terraform|import|resiz|upgrade|webhook|cron|logs?\b/i],
  ["manage", /dashboard|console|studio|billing|payment|subscription|sign[- ]?up|sign[- ]?in|login|log[- ]in|auth0|account|organi[sz]ation|api keys?|cloud manager|settings/i],
  ["data", /database|postgres|mysql|mongo|redis|kafka|vector|qstash|queue|search|cluster|connect|pooler|supavisor|pgbouncer|quer(?:y|ies)|reads?\b|writes?\b|replica|storage|rest api|data api|graphql|api gateway|serverless|dedicated|advanced|basic|standard|free tier|pay as you go|\b(?:aws|gcp|azure)\b|region|\b[a-z]{2}-[a-z]+-?\d\b/i],
];

export function surfaceForComponent(name: string, overrides?: Map<string, Surface>, categorySlug?: string): Surface | null {
  // Overrides name the bare component; incidents may carry it as "Group - Name".
  const o = overrides?.get(name) ?? (name.includes(" - ") ? overrides?.get(name.slice(name.lastIndexOf(" - ") + 3)) : undefined);
  if (o) return o;
  if (categorySlug === "cloud") {
    for (const [surface, re] of CLOUD_SURFACE_RULES) if (re.test(name)) return surface;
  }
  if (categorySlug === "databases") {
    for (const [surface, re] of DATABASE_SURFACE_RULES) if (re.test(name)) return surface;
  }
  for (const [surface, re] of SURFACE_RULES) {
    if (!re.test(name)) continue;
    if (surface === "serving" && categorySlug === "hosting" && HOSTING_CONTROL_PLANE_RE.test(name) && !HOSTING_SERVING_RE.test(name)) {
      return "ship";
    }
    return surface;
  }
  return null;
}

function levelFromImpact(i: Impact): Level {
  return i === "critical" ? "full" : i === "major" ? "partial" : "minor";
}
function levelFromStatus(s: Status | null): Level | null {
  if (s === "major_outage") return "full";
  if (s === "partial_outage") return "partial";
  if (s === "degraded") return "minor";
  return null;
}
const LEVEL_RANK: Record<Level, number> = { minor: 0, partial: 1, full: 2 };

// rows: surface, columns: provider says minor / partial / full
const MATRIX: Record<Surface, Record<Level, Tier>> = {
  serving: { minor: 2, partial: 1, full: 1 },
  data: { minor: 2, partial: 1, full: 1 },
  ship: { minor: 3, partial: 3, full: 2 },
  manage: { minor: 4, partial: 3, full: 3 },
  peripheral: { minor: 4, partial: 4, full: 4 },
};

/** Security moves an incident up one tier, with Sev 2 as the floor. */
export function securityBump(tier: Tier): Tier {
  return Math.max(1, Math.min(tier - 1, 2)) as Tier;
}

export function singleRegion(regions: string[] | null | undefined): string | null {
  return regions?.length === 1 ? regions[0] : null;
}

/**
 * Clouds run dozens of regions. One region going dark hurts the people in it, but
 * it isn't the provider going dark, so an incident confined to one region tops out
 * at Sev 2. Applied to the rules grade and to Claude's; data loss is never held.
 */
export function holdToRegion<C extends { tier: Tier; areaTiers: Partial<Record<Area, Tier>> }>(c: C, regions: string[] | null | undefined): C {
  if (!singleRegion(regions) || c.tier === 0 || c.tier >= REGIONAL_FLOOR) return c;
  const areaTiers = { ...c.areaTiers };
  for (const a of Object.keys(areaTiers) as Area[]) areaTiers[a] = Math.max(areaTiers[a]!, REGIONAL_FLOOR) as Tier;
  return { ...c, tier: REGIONAL_FLOOR, areaTiers };
}

export interface ClassifyInput {
  title: string;
  impact: Impact;
  components: string[];
  worstComponentStatus: Status | null;
  /** Affected cloud regions; exactly one caps the tier at REGIONAL_FLOOR. */
  regions?: string[] | null;
  updateText?: string;
  categorySlug?: string;
}

export interface Classification {
  tier: Tier;
  areaTiers: Partial<Record<Area, Tier>>;
  surfaces: Surface[];
  security: boolean;
  lowConfidence: boolean;
  reason: string;
  classifierVersion: number;
  scope?: Scope | null;
}

export function classify(input: ClassifyInput, overrides?: Map<string, Surface>): Classification {
  const text = `${input.title}\n${input.updateText ?? ""}`;
  const statusLevel = levelFromStatus(input.worstComponentStatus);
  const impactLevel = levelFromImpact(input.impact);
  const level = statusLevel && LEVEL_RANK[statusLevel] > LEVEL_RANK[impactLevel] ? statusLevel : impactLevel;

  if (MAINTENANCE_RE.test(input.title) && input.impact === "none") {
    return {
      tier: 0,
      areaTiers: {},
      surfaces: [],
      security: false,
      lowConfidence: false,
      reason: "Scheduled maintenance, not counted",
      classifierVersion: CLASSIFIER_VERSION,
    };
  }

  let lowConfidence = false;
  const bySurface = new Map<Surface, string>(); // surface -> first component that produced it
  for (const c of input.components) {
    const s = surfaceForComponent(c, overrides, input.categorySlug);
    if (s) {
      if (!bySurface.has(s)) bySurface.set(s, c);
    } else lowConfidence = true;
  }
  const fromTitle = bySurface.size === 0;
  if (fromTitle) {
    // No usable components: fall back to the title, then to "serving" for the
    // provider's main product. Marked low confidence for the review list.
    lowConfidence = true;
    const s = surfaceForComponent(input.title, undefined, input.categorySlug) ?? "serving";
    bySurface.set(s, input.title);
  }

  // Graded by impact, not component name: a dashboard or billing hiccup that the
  // provider says blocked deploys or froze accounts counts as Can't ship.
  const blocked = BLOCKED_RE.test(text);
  if (blocked && !bySurface.has("ship") && !bySurface.has("manage") && !bySurface.has("serving") && !bySurface.has("data")) {
    bySurface.set("manage", bySurface.get("peripheral") ?? input.title);
  }

  const surfaces = [...bySurface.keys()];
  const areaTiers: Partial<Record<Area, Tier>> = {};
  let tier: Tier = 4;
  let worstSurface: Surface = surfaces[0];
  for (const s of surfaces) {
    let t = MATRIX[s][level];
    if (blocked && s === "manage") t = Math.min(t, 3) as Tier;
    const area = areaFor(s, t);
    if (area) areaTiers[area] = Math.min(areaTiers[area] ?? 4, t) as Tier;
    if (t < tier) {
      tier = t;
      worstSurface = s;
    }
  }

  const region = singleRegion(input.regions);
  const held = holdToRegion({ tier, areaTiers }, input.regions);
  const capped = held.tier !== tier;
  tier = held.tier;
  Object.assign(areaTiers, held.areaTiers);

  const levelWord = level === "full" ? "a major outage" : level === "partial" ? "a partial outage" : "degraded performance";
  let reason = fromTitle
    ? `Sev ${tier} from the incident title (no components listed)`
    : `Sev ${tier} because ${bySurface.get(worstSurface)} had ${levelWord}`;
  if (region) reason += capped ? `, held to Sev ${REGIONAL_FLOOR} as only ${region} was hit` : ` in ${region}`;

  const security = SECURITY_RE.test(text);
  if (DATA_LOSS_RE.test(text)) {
    tier = 1;
    areaTiers.production = 1;
    reason = "Sev 1 because the provider reported data loss or exposure";
  } else if (security) {
    const bumped = securityBump(tier);
    if (bumped !== tier) reason += `, raised to Sev ${bumped} for security`;
    tier = bumped;
  }

  return { tier, areaTiers, surfaces, security, lowConfidence, reason, classifierVersion: CLASSIFIER_VERSION, scope: region ? "regional" : null };
}
