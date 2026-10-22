import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { readProvider } from "@/lib/adapters";
import { fixtureName, makeGetter } from "@/lib/fetcher";

beforeAll(() => {
  process.env.STATUS_FIXTURES_DIR = path.join(__dirname, "fixtures");
});

describe("fixtureName", () => {
  it("maps URLs to stable file names", () => {
    expect(fixtureName("https://www.vercel-status.com/api/v2/summary.json")).toBe("www.vercel-status.com__api_v2_summary.json");
    expect(fixtureName("https://api.railwaystatus.com/status")).toBe("api.railwaystatus.com__status.json");
  });
});

describe("statuspage adapter", () => {
  it("normalizes summary and incidents", async () => {
    const snap = await readProvider(
      { slug: "vercel", sourceKind: "statuspage", sourceUrl: "https://www.vercel-status.com", statusPageUrl: "https://www.vercel-status.com" },
      makeGetter({}),
    );
    // The page says "minor" overall even though one edge city is in partial outage; the indicator wins.
    expect(snap.status).toBe("degraded");
    expect(snap.components?.map((c) => c.name)).toEqual(["iad1 - Washington, D.C., USA", "Builds", "Dashboard"]);
    expect(snap.components?.[0].group).toBe("Edge Network");

    const open = snap.incidents!.find((i) => i.externalId === "inc-open")!;
    expect(open.impact).toBe("major");
    expect(open.startedAt.toISOString()).toBe("2026-10-22T13:18:00.000Z");
    expect(open.resolvedAt).toBeNull();
    expect(open.worstComponentStatus).toBe("partial_outage");
    expect(open.updates.map((u) => u.externalId)).toEqual(["u1", "u2"]); // oldest first
    expect(open.url).toBe("https://stspg.io/abc");

    const builds = snap.incidents!.find((i) => i.externalId === "inc-builds")!;
    expect(builds.monitoringAt?.toISOString()).toBe("2026-10-20T10:40:00.000Z");
    expect(builds.url).toBe("https://www.vercel-status.com/incidents/inc-builds");

    expect(snap.incidents!.find((i) => i.externalId === "inc-sec")!.postmortem).toBe(true);
  });

  it("returns nothing for parts that were not modified", async () => {
    const snap = await readProvider(
      { slug: "x", sourceKind: "statuspage", sourceUrl: "https://x.test", statusPageUrl: "https://x.test" },
      async () => ({ notModified: true }),
    );
    expect(snap.status).toBeUndefined();
    expect(snap.incidents).toBeUndefined();
  });

  it("rejects an unexpected shape", async () => {
    await expect(
      readProvider({ slug: "x", sourceKind: "statuspage", sourceUrl: "https://x.test", statusPageUrl: "https://x.test" }, async () => ({ notModified: false, body: "<html>" })),
    ).rejects.toThrow(/unexpected shape/);
  });
});

describe("railway adapter", () => {
  it("flattens groups and derives the overall status", async () => {
    const snap = await readProvider(
      { slug: "railway", sourceKind: "railway", sourceUrl: "https://api.railwaystatus.com/status", statusPageUrl: "https://status.railway.com" },
      makeGetter({}),
    );
    expect(snap.status).toBe("partial_outage");
    expect(snap.components).toContainEqual({ name: "Edge Network", status: "operational", group: "US West (California, USA)" });
    expect(snap.components).toContainEqual({ name: "Payments & Billing", status: "operational", group: undefined });
    const [i] = snap.incidents!;
    expect(i.status).toBe("identified");
    expect(i.impact).toBe("major");
    expect(i.components).toEqual(["API — backboard.railway.com"]);
  });
});

describe("heroku adapter", () => {
  it("maps systems and incidents", async () => {
    const snap = await readProvider(
      { slug: "heroku", sourceKind: "heroku", sourceUrl: "https://status.heroku.com", statusPageUrl: "https://status.heroku.com" },
      makeGetter({}),
    );
    expect(snap.status).toBe("major_outage");
    const [i] = snap.incidents!;
    expect(i.externalId).toBe("2901");
    expect(i.impact).toBe("critical");
    expect(i.components).toEqual(["Apps (runtime)"]);
  });
});
