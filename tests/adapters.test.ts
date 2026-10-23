import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { readProvider } from "@/lib/adapters";
import { fixtureName, makeGetter } from "@/lib/fetcher";
import { dropBareTwins } from "@/lib/status";
import { CATEGORIES, PROVIDERS } from "@/lib/providers";
import type { Surface } from "@/lib/severity";

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

describe("dropBareTwins", () => {
  it("keeps the grouped name and drops its bare twin", () => {
    expect(dropBareTwins(["Builds", "Build & Deploy - Builds", "Dashboard", "Dashboard"])).toEqual(["Build & Deploy - Builds", "Dashboard"]);
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

  it("reads history from the incidents endpoint, open incidents from current-status", async () => {
    const snap = await readProvider(
      { slug: "heroku", sourceKind: "heroku", sourceUrl: "https://status.heroku.com", statusPageUrl: "https://status.heroku.com" },
      makeGetter({}),
    );
    expect(snap.incidents!.map((i) => i.externalId).sort()).toEqual(["2890", "2901"]);
    // The open one comes from current-status (red), not the stale history copy (yellow).
    expect(snap.incidents!.find((i) => i.externalId === "2901")!.impact).toBe("critical");
    // No resolved_at: the last update closes it.
    expect(snap.incidents!.find((i) => i.externalId === "2890")!.resolvedAt).toEqual(new Date("2026-09-30T15:10:00Z"));
  });

  it("closes a past incident by its resolved update when the flags are missing", async () => {
    const hk = { slug: "heroku", sourceKind: "heroku" as const, sourceUrl: "https://hk.test", statusPageUrl: "https://hk.test" };
    const snap = await readProvider(hk, async (url) => ({
      notModified: false,
      body: url.includes("/incidents")
        ? [
            {
              id: 9,
              title: "Heroku Feature Degradation",
              created_at: "2026-08-10T15:19:00Z",
              systems: [{ name: "Apps", status: "yellow" }],
              updates: [
                { id: 1, created_at: "2026-08-10T15:19:00Z", contents: "Incident resolved.", update_type: "resolved" },
                { id: 2, created_at: "2026-08-10T15:26:00Z", contents: "Investigating.", update_type: "investigating" },
                { id: 3, created_at: "2026-08-10T15:46:00Z", contents: "Rolled back.", update_type: "update" },
              ],
            },
          ]
        : { status: [{ system: "Apps", status: "green" }], incidents: [] },
    }));
    expect(snap.incidents![0]).toMatchObject({ status: "resolved", resolvedAt: new Date("2026-08-10T15:46:00Z") });
  });

  it("keeps current-status when the history call fails", async () => {
    const hk = { slug: "heroku", sourceKind: "heroku" as const, sourceUrl: "https://hk.test", statusPageUrl: "https://hk.test" };
    const snap = await readProvider(hk, async (url) => {
      if (url.includes("/incidents")) throw new Error("hk.test answered 500");
      return { notModified: false, body: { status: [{ system: "Apps", status: "green" }], incidents: [] } };
    });
    expect(snap.status).toBe("operational");
    expect(snap.incidents).toEqual([]);
  });
});

describe("adapter edge cases", () => {
  const sp = { slug: "x", sourceKind: "statuspage" as const, sourceUrl: "https://x.test/", statusPageUrl: "https://x.test/" };
  const serve = (bodies: Record<string, unknown>) => async (url: string) => ({ notModified: false as const, body: bodies[new URL(url).pathname] });

  it("statuspage: no indicator falls back to the worst component, and dates fall back sensibly", async () => {
    const snap = await readProvider(
      sp,
      serve({
        "/api/v2/summary.json": { components: [{ id: "a", name: "API", status: "major_outage" }, { id: "b", name: "Docs", status: "something_new" }] },
        "/api/v2/incidents.json": {
          incidents: [
            {
              id: "i1",
              name: "API down",
              status: "resolved",
              impact: "surprise",
              created_at: "2026-10-01T10:00:00Z",
              resolved_at: "2026-10-01T11:00:00Z",
              incident_updates: [
                { id: "a", status: "monitoring", body: null, created_at: "2026-10-01T10:45:00Z" },
                { id: "b", status: "investigating", body: "x", created_at: "2026-10-01T10:00:00Z", affected_components: [{ name: "API", new_status: "major_outage", old_status: "operational" }] },
              ],
            },
          ],
        },
      }),
    );
    expect(snap.status).toBe("major_outage");
    expect(snap.components?.[1].status).toBe("unknown");
    const [i] = snap.incidents!;
    expect(i.startedAt.toISOString()).toBe("2026-10-01T10:00:00.000Z");
    expect(i.monitoringAt?.toISOString()).toBe("2026-10-01T10:45:00.000Z");
    expect(i.impact).toBe("none");
    expect(i.components).toEqual(["API"]);
    expect(i.worstComponentStatus).toBe("major_outage");
    expect(i.url).toBe("https://x.test/incidents/i1");
    expect(i.updates[1].body).toBe("");
  });

  it("railway: a maintenance in progress shows, a 304 keeps everything, junk throws", async () => {
    const rw = { slug: "railway", sourceKind: "railway" as const, sourceUrl: "https://rw.test/status", statusPageUrl: "https://status.railway.com" };
    const snap = await readProvider(rw, async () => ({
      notModified: false,
      body: { components: [{ id: "a", name: "API", status: "OPERATIONAL" }], incidents: [], maintenances: [{ status: "IN_PROGRESS" }] },
    }));
    expect(snap.status).toBe("maintenance");
    expect(await readProvider(rw, async () => ({ notModified: true }))).toEqual({});
    await expect(readProvider(rw, async () => ({ notModified: false, body: {} }))).rejects.toThrow(/unexpected shape/);
  });

  it("railway: an incident in monitoring no longer holds the page status down", async () => {
    const rw = { slug: "railway", sourceKind: "railway" as const, sourceUrl: "https://rw.test/status", statusPageUrl: "https://status.railway.com" };
    const incident = (status: string) => ({
      id: "i1",
      title: "Builds paused",
      status,
      createdAt: "2026-10-21T07:24:00Z",
      updatedAt: "2026-10-23T09:30:00Z",
      worstImpact: "MAJOR_OUTAGE",
      components: [{ impact: "MAJOR_OUTAGE", component: { name: "Builds" } }],
      updates: [{ id: "u1", status: "IDENTIFIED", message: "Builds paused.", createdAt: "2026-10-21T08:00:00Z" }],
    });
    const read = (status: string) =>
      readProvider(rw, async () => ({ notModified: false, body: { components: [{ id: "a", name: "Builds", status: "OPERATIONAL" }], incidents: [incident(status)] } }));
    expect((await read("IDENTIFIED")).status).toBe("major_outage");
    const monitoring = await read("MONITORING");
    expect(monitoring.status).toBe("operational");
    // Flipped to monitoring with no update saying so: the flip time stands in.
    expect(monitoring.incidents![0].monitoringAt?.toISOString()).toBe("2026-10-23T09:30:00.000Z");
  });

  it("heroku: resolved incidents and unknown systems", async () => {
    const hk = { slug: "heroku", sourceKind: "heroku" as const, sourceUrl: "https://hk.test", statusPageUrl: "https://hk.test" };
    const snap = await readProvider(hk, async () => ({
      notModified: false,
      body: {
        status: [{ system: "Apps", status: "green" }, { system: "Other", status: "blue" }],
        incidents: [{ id: 7, title: "Done", created_at: "2026-10-01T00:00:00Z", resolved: true, systems: [{ name: "Tools", status: "yellow" }], updates: [] }],
      },
    }));
    expect(snap.status).toBe("maintenance");
    expect(snap.components?.[1]).toEqual({ name: "Other", status: "maintenance" });
    expect(snap.incidents![0]).toMatchObject({ status: "resolved", impact: "minor", components: ["Tools (deploys, dashboard, CLI)"], url: null });
  });
});

describe("provider registry", () => {
  it("has unique slugs, known categories and https sources", () => {
    const SURFACES: Surface[] = ["serving", "data", "ship", "manage", "peripheral"];
    const slugs = PROVIDERS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const cats = new Set(CATEGORIES.map((c) => c.slug));
    for (const p of PROVIDERS) {
      expect(cats.has(p.category), p.slug).toBe(true);
      expect(p.slug).toMatch(/^[a-z0-9-]+$/);
      for (const url of [p.sourceUrl, p.statusPageUrl, p.homepageUrl]) expect(new URL(url).protocol, `${p.slug} ${url}`).toBe("https:");
      for (const s of Object.values(p.surfaces ?? {})) expect(SURFACES, p.slug).toContain(s);
    }
  });
});
