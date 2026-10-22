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

/**
 * The same imaginary customer for every provider in a category. A category is
 * only priced when that comparison is fair: AI APIs are left out on purpose,
 * because models differ too much in capability for price alone to mean much.
 */
export const WORKLOADS: Record<string, Workload> = {
  hosting: {
    title: "One small production web app",
    summary: "512 MB app on all month, 1M requests, 100 GB out, commercial use, one seat. Cheapest plan that runs it.",
    unit: "/mo",
  },
  cloud: {
    title: "One small always-on VM",
    summary: "2 vCPU (burstable) and 4 GB Linux VM on all month, 30 GB SSD disk, a public IPv4, 100 GB out. On-demand, cheapest US region, no commitments.",
    unit: "/mo",
  },
  databases: {
    title: "One small production database",
    summary: "10 GB of data, about 1 GB of RAM on all month, 10M queries a month, one region, no replicas, commercial use. Cheapest plan that runs it.",
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

  // Cloud: 730 hours a month, on-demand list prices.
  aws: {
    plan: "EC2 t4g.medium, us-east-1",
    lines: [
      { label: "t4g.medium (2 vCPU, 4 GiB) at $0.0336/hr", usd: 24.53 },
      { label: "30 GB gp3 EBS at $0.08/GB", usd: 2.4 },
      { label: "Public IPv4 at $0.005/hr", usd: 3.65 },
      { label: "100 GB out (first 100 GB a month free)", usd: 0 },
    ],
    note: "Graviton (Arm). The x86 t3.medium is $0.0416/hr.",
    source: "https://aws.amazon.com/ec2/pricing/on-demand/",
    checked: "2026-10-22",
  },
  gcp: {
    plan: "Compute Engine e2-medium, us-central1",
    lines: [
      { label: "e2-medium (2 shared vCPU, 4 GB) at $0.0335/hr", usd: 24.46 },
      { label: "30 GB balanced persistent disk at $0.10/GB", usd: 3 },
      { label: "External IPv4 at $0.005/hr", usd: 3.65 },
      { label: "100 GB out at $0.12/GB (Premium tier)", usd: 12 },
    ],
    estimate: true,
    note: "Egress price depends on where the traffic goes; Standard tier is cheaper.",
    source: "https://cloud.google.com/compute/vm-instance-pricing",
    checked: "2026-10-22",
  },
  azure: {
    plan: "Virtual Machines B2s, East US",
    lines: [
      { label: "B2s (2 vCPU, 4 GiB) at $0.0416/hr", usd: 30.37 },
      { label: "32 GiB Standard SSD (E4)", usd: 2.4 },
      { label: "Standard public IPv4 at $0.005/hr", usd: 3.65 },
      { label: "100 GB out (first 100 GB a month free)", usd: 0 },
    ],
    source: "https://azure.microsoft.com/en-us/pricing/details/virtual-machines/linux/",
    checked: "2026-10-22",
  },

  // Databases
  supabase: {
    plan: "Pro, Micro compute",
    lines: [
      { label: "Pro plan", usd: 25 },
      { label: "Micro compute (1 GB RAM)", usd: 10 },
      { label: "Included compute credit", usd: -10 },
      { label: "2 GB disk over the 8 GB included, at $0.125/GB", usd: 0.25 },
    ],
    source: "https://supabase.com/pricing",
    checked: "2026-10-22",
  },
  neon: {
    plan: "Launch, 0.25 CU always on",
    lines: [
      { label: "0.25 CU (about 1 GB RAM) for 730 h at $0.106/CU-hour", usd: 19.35 },
      { label: "10 GB storage at $0.35/GB-month", usd: 3.5 },
    ],
    estimate: true,
    note: "Assumes scale to zero is off and autoscaling stays at 0.25 CU.",
    source: "https://neon.com/docs/introduction/plans",
    checked: "2026-10-22",
  },
  planetscale: {
    plan: "Postgres PS-10, single node",
    lines: [{ label: "PS-10 arm64 (1 GiB RAM, 10 GB storage included)", usd: 10 }],
    note: "Single node has no replicas; the HA version is $30.",
    source: "https://planetscale.com/pricing",
    checked: "2026-10-22",
  },
  mongodb: {
    plan: "Atlas M10, AWS us-east-1",
    lines: [{ label: "M10 (2 GB RAM, 10 GB storage)", usd: 56.94 }],
    note: "Flex tops out at 5 GB, so 10 GB needs a dedicated cluster. M10 is a three-node replica set. Backups are extra.",
    source: "https://www.mongodb.com/pricing",
    checked: "2026-10-22",
  },
  upstash: {
    plan: "Redis, pay as you go",
    lines: [
      { label: "10M commands at $0.20/100K", usd: 20 },
      { label: "9 GB storage over the 1 GB free, at $0.25/GB", usd: 2.25 },
    ],
    estimate: true,
    note: "Redis, not a relational database. Assumes one command per query.",
    source: "https://upstash.com/pricing/redis",
    checked: "2026-10-22",
  },
  cockroachdb: {
    plan: "Billed in request units",
    lines: [],
    note: "Basic bills request units and Standard bills provisioned vCPUs; neither maps cleanly to this workload.",
    source: "https://www.cockroachlabs.com/pricing/new",
    checked: "2026-10-22",
  },
};

const DAY = 86_400_000;

/** Monthly total for the reference workload, or null when there's no comparable price. */
export function monthlyUsd(p: Price | undefined): number | null {
  if (!p || p.lines.length === 0) return null;
  return Math.round(p.lines.reduce((n, l) => n + l.usd, 0) * 100) / 100;
}

/** Whether a category shows cost at all. */
export function isPriced(category: string): boolean {
  return category in WORKLOADS;
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
