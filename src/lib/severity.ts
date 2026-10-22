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

export const CLASSIFIER_VERSION = 2;

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

export function surfaceForComponent(name: string, overrides?: Map<string, Surface>, categorySlug?: string): Surface | null {
  const o = overrides?.get(name);
  if (o) return o;
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

export interface ClassifyInput {
  title: string;
  impact: Impact;
  components: string[];
  worstComponentStatus: Status | null;
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

  const levelWord = level === "full" ? "a major outage" : level === "partial" ? "a partial outage" : "degraded performance";
  let reason = fromTitle
    ? `Sev ${tier} from the incident title (no components listed)`
    : `Sev ${tier} because ${bySurface.get(worstSurface)} had ${levelWord}`;

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

  return { tier, areaTiers, surfaces, security, lowConfidence, reason, classifierVersion: CLASSIFIER_VERSION };
}
