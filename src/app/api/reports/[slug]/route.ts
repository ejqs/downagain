import { db } from "@/db";
import { addReport, cachedCounts, clientIp, forgetCounts, providerIdFor, reporterId, turnstileKeys, verifyTurnstile } from "@/lib/reports";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };
const SLUG = /^[a-z0-9-]{1,40}$/;
const json = (body: unknown, status = 200, cache = "no-store") => Response.json(body, { status, headers: { "Cache-Control": cache } });

/** "Down for me" counts for one provider, fetched by the page so the page itself stays cacheable. */
export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  if (!SLUG.test(slug)) return json({ error: "not found" }, 404);
  try {
    const database = db();
    const id = await providerIdFor(database, slug);
    if (id == null) return json({ error: "not found" }, 404);
    return json(await cachedCounts(database, id), 200, "public, max-age=0, s-maxage=20, stale-while-revalidate=40");
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}

/** One report, only with a Turnstile token Cloudflare vouches for. */
export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params;
  if (!SLUG.test(slug)) return json({ error: "not found" }, 404);
  const keys = turnstileKeys();
  if (!keys) return json({ error: "reports are off" }, 503);
  if (Number(req.headers.get("content-length") ?? 0) > 4096) return json({ error: "too large" }, 413);

  let token: unknown;
  try {
    token = ((await req.json()) as { token?: unknown }).token;
  } catch {
    return json({ error: "bad request" }, 400);
  }
  if (typeof token !== "string" || !token || token.length > 2048) return json({ error: "bad request" }, 400);

  const ip = clientIp(req.headers);
  if (!(await verifyTurnstile(token, slug, ip, keys.secret))) return json({ error: "check failed" }, 403);

  try {
    const database = db();
    const id = await providerIdFor(database, slug);
    if (id == null) return json({ error: "not found" }, 404);
    const now = Date.now();
    // Without an IP every visitor would share one pseudonym; the token alone still proves a human.
    const reporter = reporterId(ip ?? `anon-${crypto.randomUUID()}`, now, keys.secret);
    const outcome = await addReport(database, { providerId: id, reporter, country: req.headers.get("cf-ipcountry"), now });
    if (outcome === "limited") return json({ error: "too many reports" }, 429);
    if (outcome === "added") forgetCounts(id);
    return json({ outcome, ...(await cachedCounts(database, id, now)) });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
