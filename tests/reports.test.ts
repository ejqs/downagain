import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { userReports } from "@/db/schema";
import type { DB } from "@/db";
import { clientIp, countReports, forgetCounts, MAX_PER_HOUR, reporterId, verifyTurnstile } from "@/lib/reports";
import { testDb } from "./helpers/db";

const state = vi.hoisted(() => ({ database: null as unknown }));
vi.mock("@/db", async (orig) => ({ ...(await orig<typeof import("@/db")>()), db: () => state.database }));

const { GET, POST } = await import("@/app/api/reports/[slug]/route");

// Stands in for Cloudflare's siteverify: "good" tokens pass, anything else fails.
const siteverify = vi.fn(async (_url: string, init: RequestInit) => {
  const form = new URLSearchParams(init.body as URLSearchParams);
  const ok = form.get("response")?.startsWith("good");
  return Response.json({ success: ok, action: "report", cdata: form.get("response")?.split(":")[1] ?? "" });
});

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const get = (slug: string) => GET(new Request(`http://localhost/api/reports/${slug}`), ctx(slug));
const post = (slug: string, token: unknown, ip = "203.0.113.7") =>
  POST(
    new Request(`http://localhost/api/reports/${slug}`, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip, "cf-ipcountry": "SG" },
      body: JSON.stringify({ token }),
    }),
    ctx(slug),
  );

let close: () => Promise<void>;
let database: DB;

beforeAll(async () => {
  const t = await testDb();
  state.database = database = t.database;
  close = t.close;
  vi.stubGlobal("fetch", siteverify);
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await close();
});
beforeEach(async () => {
  process.env.TURNSTILE_SITE_KEY = "site";
  process.env.TURNSTILE_SECRET_KEY = "secret";
  await database.delete(userReports);
  forgetCounts();
  siteverify.mockClear();
});

describe("user reports", () => {
  it("counts start at zero, and unknown or junk slugs 404", async () => {
    const res = await get("vercel");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lastHour: 0, hours: Array(24).fill(0) });
    expect((await get("nope")).status).toBe(404);
    expect((await get("../x")).status).toBe(404);
  });

  it("stores a report only after Cloudflare vouches for the token", async () => {
    expect((await post("vercel", "bad")).status).toBe(403);
    expect((await post("vercel", "")).status).toBe(400);
    expect((await post("vercel", 42)).status).toBe(400);
    const res = await post("vercel", "good:vercel");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: "added", lastHour: 1 });
    const form = new URLSearchParams(siteverify.mock.calls.at(-1)![1].body as URLSearchParams);
    expect(form.get("remoteip")).toBe("203.0.113.7");
    const [row] = await database.select().from(userReports);
    expect(row.country).toBe("SG");
    expect(row.reporter).not.toContain("203.0.113.7");
  });

  it("rejects a token minted for another provider's button", async () => {
    expect((await post("vercel", "good:railway")).status).toBe(403);
  });

  it("counts one report per visitor and provider per slot", async () => {
    await post("vercel", "good:vercel");
    const again = await post("vercel", "good:vercel");
    expect(await again.json()).toMatchObject({ outcome: "duplicate", lastHour: 1 });
    expect(await (await post("vercel", "good:vercel", "198.51.100.1")).json()).toMatchObject({ outcome: "added", lastHour: 2 });
  });

  it("caps one visitor across providers", async () => {
    const providers = await database.query.providers.findMany({ columns: { slug: true }, limit: MAX_PER_HOUR + 1 });
    const codes = [];
    for (const p of providers) codes.push((await post(p.slug, `good:${p.slug}`)).status);
    expect(codes.slice(0, MAX_PER_HOUR).every((c) => c === 200)).toBe(true);
    expect(codes[MAX_PER_HOUR]).toBe(429);
  });

  it("refuses everything while Turnstile keys are unset", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    expect((await post("vercel", "good:vercel")).status).toBe(503);
    expect(siteverify).not.toHaveBeenCalled();
  });

  it("buckets the last 24 hours by hour, oldest first", async () => {
    const now = Date.now();
    const [p] = await database.query.providers.findMany({ columns: { id: true }, limit: 1 });
    const at = (h: number, i: number) => ({ providerId: p.id, reporter: `r${h}-${i}`, slot: i + h * 10, createdAt: new Date(now - h * 3_600_000 - 60_000) });
    await database.insert(userReports).values([at(0, 0), at(0, 1), at(5, 0), at(30, 0)]);
    const c = await countReports(database, p.id, now);
    expect(c.lastHour).toBe(2);
    expect(c.hours[18]).toBe(1);
    expect(c.hours.reduce((a, b) => a + b, 0)).toBe(3);
  });
});

describe("helpers", () => {
  it("prefers Cloudflare's client IP header", () => {
    expect(clientIp(new Headers({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIp(new Headers({ "x-forwarded-for": "2.2.2.2, 10.0.0.1" }))).toBe("2.2.2.2");
    expect(clientIp(new Headers())).toBeNull();
  });

  it("gives a visitor the same pseudonym all day and a new one the next", () => {
    const day = Date.UTC(2026, 9, 23, 1);
    expect(reporterId("1.1.1.1", day, "s")).toBe(reporterId("1.1.1.1", day + 20 * 3_600_000, "s"));
    expect(reporterId("1.1.1.1", day, "s")).not.toBe(reporterId("1.1.1.1", day + 24 * 3_600_000, "s"));
    expect(reporterId("1.1.1.1", day, "s")).not.toBe(reporterId("1.1.1.2", day, "s"));
  });

  it("fails closed when siteverify errors or times out", async () => {
    const boom = vi.fn(async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    expect(await verifyTurnstile("t", "vercel", null, "s", boom)).toBe(false);
    const http500 = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    expect(await verifyTurnstile("t", "vercel", null, "s", http500)).toBe(false);
  });
});
