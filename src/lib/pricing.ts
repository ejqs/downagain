// What each provider costs for one reference workload per category, hand-checked
// against the provider's own public pricing page. Status pages don't carry prices,
// so this is curated data, not polled.
//
// To refresh: `bun run prices` lists every entry oldest-checked first with its
// source link. Open each source, fix the lines, and set `checked` to today. The
// site flags any entry older than STALE_AFTER_DAYS as possibly out of date.

export const STALE_AFTER_DAYS = 90;

export interface Workload {
  title: string;
  summary: string;
  /** Unit the comparison is quoted in. */
  unit: string;
}

/** The same imaginary customer for every provider in a category. */
export const WORKLOADS: Record<string, Workload> = {
  hosting: {
    title: "One small production web app",
    summary: "512 MB app on all month, 1M requests, 100 GB out, commercial use, one seat. Cheapest plan that runs it.",
    unit: "/mo",
  },
  ai: {
    title: "An everyday LLM workload",
    summary: "30M input and 10M output tokens a month on each provider's everyday model, standard rates. Models differ in quality.",
    unit: "/mo",
  },
};

export interface PriceLine {
  label: string;
  usd: number;
}

export interface Price {
  /** Plan or model the price is for. */
  plan: string;
  /** Lines that add up to the monthly total. Empty when there's no like-for-like price. */
  lines: PriceLine[];
  /** Usage-billed, so the total depends on an assumption spelled out in `note`. */
  estimate?: boolean;
  note?: string;
  source: string;
  /** Date (UTC, YYYY-MM-DD) someone last read `source` and confirmed these lines. */
  checked: string;
}

// AI workload in millions of tokens.
const IN = 30;
const OUT = 10;
const tokens = (inPerM: number, outPerM: number): PriceLine[] => [
  { label: `${IN}M input tokens at $${inPerM}/M`, usd: IN * inPerM },
  { label: `${OUT}M output tokens at $${outPerM}/M`, usd: OUT * outPerM },
];

export const PRICES: Record<string, Price> = {
  // Hosting
  railway: {
    plan: "Hobby",
    lines: [
      { label: "Hobby plan (includes $5 of usage)", usd: 5 },
      { label: "512 MB RAM all month at $10/GB", usd: 5 },
      { label: "0.1 vCPU average at $20/vCPU", usd: 2 },
      { label: "100 GB egress at $0.05/GB", usd: 5 },
      { label: "Included usage credit", usd: -5 },
    ],
    estimate: true,
    note: "Railway bills actual CPU use; this assumes the app averages 10% of one vCPU.",
    source: "https://docs.railway.com/pricing/plans",
    checked: "2026-10-22",
  },
  vercel: {
    plan: "Pro, one seat",
    lines: [{ label: "Pro seat (includes $20 of usage)", usd: 20 }],
    estimate: true,
    note: "Hobby is for personal, non-commercial use only. Assumes the workload fits Pro's included $20 usage credit; serverless, so memory isn't reserved.",
    source: "https://vercel.com/pricing",
    checked: "2026-10-22",
  },
  netlify: {
    plan: "Pro",
    lines: [{ label: "Pro plan (3,000 credits)", usd: 20 }],
    estimate: true,
    note: "100 GB is 2,000 credits and 1M requests 200, so it outgrows Personal's 1,000 credits but fits Pro. Serverless, so memory isn't reserved.",
    source: "https://www.netlify.com/pricing/",
    checked: "2026-10-22",
  },
  render: {
    plan: "Hobby workspace, Starter instance",
    lines: [
      { label: "Starter web service (512 MB)", usd: 7 },
      { label: "95 GB bandwidth over the 5 GB included, at $0.15/GB", usd: 14.25 },
    ],
    source: "https://render.com/pricing",
    checked: "2026-10-22",
  },
  fly: {
    plan: "Pay as you go",
    lines: [
      { label: "shared-cpu-1x, 512 MB, cheapest region", usd: 3.69 },
      { label: "100 GB egress at $0.02/GB (North America, Europe)", usd: 2 },
    ],
    source: "https://docs.fly.io/about/pricing",
    checked: "2026-10-22",
  },
  heroku: {
    plan: "Basic dyno",
    lines: [{ label: "Basic dyno (512 MB, doesn't sleep)", usd: 7 }],
    note: "Eco is cheaper but sleeps when idle. Heroku doesn't bill bandwidth.",
    source: "https://devcenter.heroku.com/articles/usage-and-billing",
    checked: "2026-10-22",
  },
  digitalocean: {
    plan: "App Platform, shared 512 MB",
    lines: [
      { label: "apps-s-1vcpu-0.5gb (includes 50 GiB transfer)", usd: 5 },
      { label: "50 GiB extra transfer at $0.02/GiB", usd: 1 },
    ],
    source: "https://docs.digitalocean.com/products/app-platform/details/pricing/",
    checked: "2026-10-22",
  },
  cloudflare: {
    plan: "Workers Paid",
    lines: [{ label: "Workers Paid minimum (10M requests included)", usd: 5 }],
    estimate: true,
    note: "Workers has no egress charges. Assumes CPU time fits the included 30M CPU-ms; serverless, so memory isn't reserved.",
    source: "https://developers.cloudflare.com/workers/platform/pricing/",
    checked: "2026-10-22",
  },

  // AI APIs
  openai: {
    plan: "gpt-6.1-sol",
    lines: tokens(2, 10),
    source: "https://developers.openai.com/api/docs/pricing",
    checked: "2026-10-22",
  },
  anthropic: {
    plan: "Claude Sonnet 5.5",
    lines: tokens(2, 10),
    source: "https://platform.claude.com/docs/en/about-claude/pricing",
    checked: "2026-10-22",
  },
  groq: {
    plan: "gpt-oss-120b",
    lines: tokens(0.15, 0.6),
    note: "Groq serves open-weight models; this is a smaller model than the others here.",
    source: "https://console.groq.com/docs/models",
    checked: "2026-10-22",
  },
  cohere: {
    plan: "Command A",
    lines: tokens(2.5, 10),
    source: "https://docs.cohere.com/docs/command-a",
    checked: "2026-10-22",
  },
  replicate: {
    plan: "Billed by GPU time",
    lines: [],
    note: "Most Replicate models are billed per second of GPU time, so there's no like-for-like token price.",
    source: "https://replicate.com/pricing",
    checked: "2026-10-22",
  },
};

const DAY = 86_400_000;

/** Monthly total for the reference workload, or null when there's no comparable price. */
export function monthlyUsd(p: Price | undefined): number | null {
  if (!p || p.lines.length === 0) return null;
  return Math.round(p.lines.reduce((n, l) => n + l.usd, 0) * 100) / 100;
}

export function checkedMs(p: Price): number {
  return Date.parse(`${p.checked}T00:00:00Z`);
}

export function isStale(p: Price, now = Date.now()): boolean {
  return now - checkedMs(p) > STALE_AFTER_DAYS * DAY;
}

export function fmtUsd(usd: number): string {
  const abs = Math.abs(usd);
  const s = abs >= 100 || Number.isInteger(abs) ? `$${Math.round(abs).toLocaleString("en-US")}` : `$${abs.toFixed(2)}`;
  return usd < 0 ? `−${s}` : s;
}

export interface ValueInput {
  id: string;
  usd: number | null;
  /** Lower is better: the grade's position in GRADES. */
  gradeRank: number;
}

export interface ValueResult {
  /** Nobody in the set is both at least as cheap and at least as reliable. */
  bestValue: boolean;
  /** The strongest provider that is cheaper-or-equal and better-or-equal, if any. */
  beatenBy: string | null;
}

/**
 * Bang for buck as a frontier, not a blended score: a provider is "best value" when
 * no other provider costs the same or less AND has the same or better grade (with
 * at least one of the two strictly better). Providers without a price are skipped.
 */
export function valueFrontier(items: ValueInput[]): Record<string, ValueResult> {
  const priced = items.filter((i): i is ValueInput & { usd: number } => i.usd != null);
  const out: Record<string, ValueResult> = {};
  for (const b of priced) {
    const beaters = priced
      .filter((a) => a.id !== b.id && a.usd <= b.usd && a.gradeRank <= b.gradeRank && (a.usd < b.usd || a.gradeRank < b.gradeRank))
      .sort((x, y) => x.gradeRank - y.gradeRank || x.usd - y.usd);
    out[b.id] = { bestValue: beaters.length === 0, beatenBy: beaters[0]?.id ?? null };
  }
  return out;
}
