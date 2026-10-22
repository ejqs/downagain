import { rm } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureDir, testDb } from "./helpers/db";

// Route handlers read through `db()` and Next's cache; swap in the test database
// and a pass-through cache, and record which tags get revalidated.
const state = vi.hoisted(() => ({ database: null as unknown, fail: false }));
const revalidateTag = vi.hoisted(() => vi.fn());
vi.mock("@/db", async (orig) => ({
  ...(await orig<typeof import("@/db")>()),
  db: () => {
    if (state.fail) throw new Error("connection refused");
    return state.database;
  },
}));
vi.mock("next/cache", () => ({ unstable_cache: <T>(fn: T) => fn, revalidateTag }));

const { POST: poll } = await import("@/app/api/cron/poll/route");
const { GET: statusJson } = await import("@/app/api/status.json/route");
const { GET: badge } = await import("@/app/badge/[file]/route");
const { GET: health } = await import("@/app/api/health/route");

const SECRET = "test-secret";
const pollReq = (qs = "?provider=vercel,railway,heroku", auth = `Bearer ${SECRET}`) =>
  new Request(`http://localhost/api/cron/poll${qs}`, { method: "POST", headers: auth ? { authorization: auth } : {} });
const badgeFor = (file: string) => badge(new Request(`http://localhost/badge/${file}`), { params: Promise.resolve({ file }) });

let close: () => Promise<void>;
let fx: Awaited<ReturnType<typeof fixtureDir>>;

beforeAll(async () => {
  const t = await testDb();
  state.database = t.database;
  close = t.close;
  fx = await fixtureDir();
  process.env.STATUS_FIXTURES_DIR = fx.dir;
  process.env.CRON_SECRET = SECRET;
});
afterAll(async () => {
  delete process.env.STATUS_FIXTURES_DIR;
  delete process.env.CRON_SECRET;
  await rm(fx.dir, { recursive: true, force: true });
  await close();
});
beforeEach(() => {
  revalidateTag.mockClear();
  state.fail = false;
});

describe("GET /api/health", () => {
  it("is ok without touching the database", async () => {
    state.fail = true;
    const res = health();
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("before the first poll", () => {
  it("status.json lists nobody, since unpolled providers are hidden", async () => {
    const body = await (await statusJson()).json();
    expect(body.providers).toEqual([]);
    expect(body.down).toEqual([]);
  });
});

describe("POST /api/cron/poll", () => {
  it("rejects a missing or wrong secret", async () => {
    expect((await poll(pollReq(undefined, ""))).status).toBe(401);
    expect((await poll(pollReq(undefined, "Bearer nope"))).status).toBe(401);
  });

  it("rejects everything when no secret is configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await poll(pollReq(undefined, "Bearer "))).status).toBe(401);
    process.env.CRON_SECRET = SECRET;
  });

  it("revalidates the shared tag and each changed provider", async () => {
    const res = await poll(pollReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.changed.sort()).toEqual(["heroku", "railway", "vercel"]);
    expect(body.failed).toEqual([]);
    expect(body.results.find((r: { slug: string }) => r.slug === "vercel")).toMatchObject({ status: "degraded", newIncidents: 3 });

    const tags = revalidateTag.mock.calls.map((c) => c[0]);
    expect(tags.sort()).toEqual(["provider:heroku", "provider:railway", "provider:vercel", "status"]);
    // Expire immediately: outages are exactly when stale pages hurt.
    for (const c of revalidateTag.mock.calls) expect(c[1]).toEqual({ expire: 0 });
  });

  it("does not revalidate when nothing changed", async () => {
    const body = await (await poll(pollReq())).json();
    expect(body.changed).toEqual([]);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("revalidates on request even without changes", async () => {
    await poll(pollReq("?provider=vercel&revalidate"));
    expect(revalidateTag.mock.calls.map((c) => c[0])).toEqual(["status"]);
  });

  it("only revalidates the provider that changed", async () => {
    await fx.edit<{ status: { indicator: string } }>("www.vercel-status.com__api_v2_summary.json", (j) => {
      j.status.indicator = "critical";
    });
    const body = await (await poll(pollReq())).json();
    expect(body.changed).toEqual(["vercel"]);
    expect(revalidateTag.mock.calls.map((c) => c[0]).sort()).toEqual(["provider:vercel", "status"]);
  });

  it("reports providers whose status page failed", async () => {
    const body = await (await poll(pollReq("?provider=netlify"))).json();
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0].slug).toBe("netlify");
  });
});

describe("GET /api/status.json", () => {
  it("lists polled providers with grades and what is down", async () => {
    const res = await statusJson();
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toContain("s-maxage");
    const body = await res.json();
    expect(body.providers.map((p: { slug: string }) => p.slug).sort()).toEqual(["heroku", "railway", "vercel"]);
    const vercel = body.providers.find((p: { slug: string }) => p.slug === "vercel");
    expect(vercel).toMatchObject({ category: "hosting", status: "major_outage" });
    expect(vercel.grade90d).toMatch(/^(A\+|[A-DF])$/);
    expect(Object.keys(vercel.areaGrades90d)).toEqual(["production", "shipping"]);
    expect(vercel.admittedUptime90d).toBeGreaterThan(0);
    expect(vercel.admittedUptime90d).toBeLessThanOrEqual(1);
    expect(body.down.map((d: { provider: string }) => d.provider)).toEqual(expect.arrayContaining(["vercel", "railway", "heroku"]));
  });

  it("answers 503 when the database is unreachable", async () => {
    state.fail = true;
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    expect((await statusJson()).status).toBe(503);
  });
});

describe("GET /badge/[slug].svg", () => {
  it("draws the grade and admitted uptime", async () => {
    const res = await badgeFor("vercel.svg");
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    const svg = await res.text();
    expect(svg).toMatch(/^<svg /);
    expect(svg).toMatch(/aria-label="vercel: (A\+|[A-DF]) · [\d.]+% · 90d"/);
  });

  it("says unknown for a provider we don't track", async () => {
    expect(await (await badgeFor("nope.svg")).text()).toContain('aria-label="downagain: unknown"');
  });
});
