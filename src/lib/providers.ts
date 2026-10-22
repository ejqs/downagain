// The launch list: Hosting first, then AI. Adding a provider is a new entry here,
// then `bun run db:seed` and `bun run backfill --provider <slug>`.
//
// A provider only appears on the site once its status source has answered at
// least once, so an entry with a wrong endpoint stays hidden instead of showing
// as broken. Check the poll route's output after deploying.
import type { Surface } from "@/lib/severity";

export interface CategorySeed {
  slug: string;
  name: string;
  sortOrder: number;
}

export interface ProviderSeed {
  slug: string;
  name: string;
  category: string;
  kind: string;
  homepageUrl: string;
  statusPageUrl: string;
  sourceKind: "statuspage" | "railway" | "heroku";
  sourceUrl: string;
  sortOrder?: number;
  /** Component names the regex rules get wrong. */
  surfaces?: Record<string, Surface>;
  /** Confirmed by reading the live endpoint (date). */
  verified?: string;
}

export const CATEGORIES: CategorySeed[] = [
  { slug: "hosting", name: "Hosting", sortOrder: 1 },
  { slug: "ai", name: "AI APIs", sortOrder: 2 },
];

export const PROVIDERS: ProviderSeed[] = [
  // Hosting
  {
    slug: "railway",
    name: "Railway",
    category: "hosting",
    kind: "PaaS",
    homepageUrl: "https://railway.com",
    statusPageUrl: "https://status.railway.com",
    sourceKind: "railway",
    sourceUrl: "https://api.railwaystatus.com/status",
    verified: "2026-10-22",
  },
  {
    slug: "vercel",
    name: "Vercel",
    category: "hosting",
    kind: "Frontend cloud",
    homepageUrl: "https://vercel.com",
    statusPageUrl: "https://www.vercel-status.com",
    sourceKind: "statuspage",
    sourceUrl: "https://www.vercel-status.com",
  },
  {
    slug: "netlify",
    name: "Netlify",
    category: "hosting",
    kind: "Frontend cloud",
    homepageUrl: "https://www.netlify.com",
    statusPageUrl: "https://www.netlifystatus.com",
    sourceKind: "statuspage",
    sourceUrl: "https://www.netlifystatus.com",
  },
  {
    slug: "render",
    name: "Render",
    category: "hosting",
    kind: "PaaS",
    homepageUrl: "https://render.com",
    statusPageUrl: "https://status.render.com",
    sourceKind: "statuspage",
    sourceUrl: "https://status.render.com",
  },
  {
    slug: "fly",
    name: "Fly.io",
    category: "hosting",
    kind: "Edge compute",
    homepageUrl: "https://fly.io",
    statusPageUrl: "https://status.flyio.net",
    sourceKind: "statuspage",
    sourceUrl: "https://status.flyio.net",
    verified: "2026-10-22",
    surfaces: { "Customer Applications": "serving", "Machines API": "ship", Dashboard: "peripheral" },
  },
  {
    slug: "heroku",
    name: "Heroku",
    category: "hosting",
    kind: "PaaS",
    homepageUrl: "https://www.heroku.com",
    statusPageUrl: "https://status.heroku.com",
    sourceKind: "heroku",
    sourceUrl: "https://status.heroku.com",
    verified: "2026-10-22",
  },
  {
    slug: "digitalocean",
    name: "DigitalOcean",
    category: "hosting",
    kind: "Cloud",
    homepageUrl: "https://www.digitalocean.com",
    statusPageUrl: "https://status.digitalocean.com",
    sourceKind: "statuspage",
    sourceUrl: "https://status.digitalocean.com",
  },
  {
    slug: "cloudflare",
    name: "Cloudflare",
    category: "hosting",
    kind: "Edge platform",
    homepageUrl: "https://www.cloudflare.com",
    statusPageUrl: "https://www.cloudflarestatus.com",
    sourceKind: "statuspage",
    sourceUrl: "https://www.cloudflarestatus.com",
  },

  // AI APIs
  {
    slug: "openai",
    name: "OpenAI API",
    category: "ai",
    kind: "LLM API",
    homepageUrl: "https://platform.openai.com",
    statusPageUrl: "https://status.openai.com",
    sourceKind: "statuspage",
    sourceUrl: "https://status.openai.com",
    verified: "2026-10-22",
    // The page also covers ChatGPT; those parts don't break anyone's API calls.
    surfaces: { Login: "peripheral", "File uploads": "peripheral", "Image Generation": "peripheral", Live: "peripheral" },
  },
  {
    slug: "anthropic",
    name: "Anthropic API",
    category: "ai",
    kind: "LLM API",
    homepageUrl: "https://www.anthropic.com/api",
    statusPageUrl: "https://status.claude.com",
    sourceKind: "statuspage",
    sourceUrl: "https://status.claude.com",
    surfaces: { "Claude Code": "ship" },
  },
  {
    slug: "groq",
    name: "Groq",
    category: "ai",
    kind: "Inference API",
    homepageUrl: "https://groq.com",
    statusPageUrl: "https://groqstatus.com",
    sourceKind: "statuspage",
    sourceUrl: "https://groqstatus.com",
  },
  {
    slug: "cohere",
    name: "Cohere",
    category: "ai",
    kind: "LLM API",
    homepageUrl: "https://cohere.com",
    statusPageUrl: "https://status.cohere.com",
    sourceKind: "statuspage",
    sourceUrl: "https://status.cohere.com",
  },
  {
    slug: "replicate",
    name: "Replicate",
    category: "ai",
    kind: "Model hosting",
    homepageUrl: "https://replicate.com",
    statusPageUrl: "https://www.replicatestatus.com",
    sourceKind: "statuspage",
    sourceUrl: "https://www.replicatestatus.com",
  },
];
