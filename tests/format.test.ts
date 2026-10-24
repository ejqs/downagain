import { afterEach, describe, expect, it, vi } from "vitest";
import { fmtAgo, fmtDuration, fmtPct, fmtRange, httpUrl, plural } from "@/lib/format";
import { impactFromStatus, isProblem, worstStatus } from "@/lib/status";
import { makeGetter, USER_AGENT } from "@/lib/fetcher";

describe("format", () => {
  it.each([
    [0, "0m"],
    [59.6, "1h 00m"],
    [125, "2h 05m"],
    [47 * 60 + 59, "47h 59m"],
    [49 * 60, "2d 1h"],
  ])("fmtDuration(%s) = %s", (m, s) => expect(fmtDuration(m)).toBe(s));

  it("fmtRange", () => {
    const d = (iso: string) => Date.parse(iso);
    expect(fmtRange(d("2026-10-21T07:00Z"), d("2026-10-24T13:00Z"))).toBe("Oct 21–24, 2026");
    expect(fmtRange(d("2026-10-30T07:00Z"), d("2026-11-02T13:00Z"))).toBe("Oct 30 – Nov 2, 2026");
    expect(fmtRange(d("2025-12-30T07:00Z"), d("2026-01-02T13:00Z"))).toBe("Dec 30, 2025 – Jan 2, 2026");
    expect(fmtRange(d("2026-10-21T07:00Z"), d("2026-10-21T13:00Z"))).toBe("Oct 21, 2026");
  });

  it("never rounds a real outage up to 100%", () => {
    expect(fmtPct(1)).toBe("100.00%");
    expect(fmtPct(0.99999)).toBe("99.99%");
    expect(fmtPct(0.9876, 1)).toBe("98.8%");
  });

  it("fmtAgo and plural", () => {
    expect(fmtAgo(1_000, 30_000)).toBe("just now");
    expect(fmtAgo(0, 90 * 60_000)).toBe("1h 30m ago");
    expect(plural(1, "incident")).toBe("1 incident");
    expect(plural(2, "incident")).toBe("2 incidents");
  });
});

describe("status", () => {
  it("picks the worst status and treats unknown as not a problem", () => {
    expect(worstStatus(["operational", "degraded", "maintenance"])).toBe("degraded");
    expect(worstStatus([])).toBe("operational");
    expect(isProblem("unknown")).toBe(false);
    expect(isProblem("maintenance")).toBe(false);
    expect(isProblem("degraded")).toBe(true);
    expect(impactFromStatus("major_outage")).toBe("critical");
    expect(impactFromStatus(null)).toBe("none");
  });
});

describe("fetcher", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("identifies itself, sends the stored ETag and honours 304", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 304 }));
    vi.stubGlobal("fetch", fetch);
    const etags = { "https://s.test/a": '"v1"' };
    expect(await makeGetter(etags)("https://s.test/a")).toEqual({ notModified: true });
    const headers = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe(USER_AGENT);
    expect(headers["If-None-Match"]).toBe('"v1"');
  });

  it("stores a new ETag and drops one the server stopped sending", async () => {
    const etags: Record<string, string> = { "https://s.test/b": '"old"' };
    vi.stubGlobal("fetch", async (url: string) => Response.json({ ok: 1 }, { headers: url.endsWith("/a") ? { etag: '"new"' } : {} }));
    expect(await makeGetter(etags)("https://s.test/a")).toEqual({ notModified: false, body: { ok: 1 } });
    await makeGetter(etags)("https://s.test/b");
    expect(etags).toEqual({ "https://s.test/a": '"new"' });
  });

  it("turns an error status into a short message", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 503 }));
    await expect(makeGetter({})("https://s.test/a")).rejects.toThrow("s.test answered 503");
  });

  it("refuses a body past the size cap", async () => {
    vi.stubGlobal("fetch", async () => new Response("x", { headers: { "content-length": String(50 * 1024 * 1024) } }));
    await expect(makeGetter({})("https://s.test/a")).rejects.toThrow(/bytes/);
    const endless = new ReadableStream({ pull: (c) => c.enqueue(new Uint8Array(1024 * 1024)) });
    vi.stubGlobal("fetch", async () => new Response(endless));
    await expect(makeGetter({})("https://s.test/a")).rejects.toThrow(/over \d+ bytes/);
  });

  it("refuses a redirect off https", async () => {
    vi.stubGlobal("fetch", async () => {
      const res = Response.json({ ok: 1 });
      Object.defineProperty(res, "url", { value: "http://web.railway.internal:8080/" });
      return res;
    });
    await expect(makeGetter({})("https://s.test/a")).rejects.toThrow("redirected off https");
  });
});

describe("httpUrl", () => {
  it("keeps http(s) links and drops everything else", () => {
    expect(httpUrl("https://stspg.io/abc")).toBe("https://stspg.io/abc");
    expect(httpUrl("http://example.com/x")).toBe("http://example.com/x");
    expect(httpUrl("javascript:alert(1)")).toBeNull();
    expect(httpUrl(" JavaScript:alert(1)")).toBeNull();
    expect(httpUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(httpUrl("/relative")).toBeNull();
    expect(httpUrl(null)).toBeNull();
  });
});
