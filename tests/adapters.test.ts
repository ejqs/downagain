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

  it("reads a post with every component marked operational as a notice", async () => {
    const station = { component: { id: "c1", name: "Support & Community — station.railway.com" }, impact: "OPERATIONAL" };
    const post = (over: object) => ({ id: "n1", title: "Clarification", status: "TRIAGE", createdAt: "2026-10-24T13:57:07Z", worstImpact: null, components: [station], ...over });
    const read = (incidents: object[]) =>
      readProvider(
        { slug: "railway", sourceKind: "railway", sourceUrl: "https://api.railwaystatus.com/status", statusPageUrl: "https://status.railway.com" },
        async () => ({ notModified: false, body: { components: [{ id: "c1", name: "Support", status: "OPERATIONAL" }], incidents } }),
      );
    const notice = await read([post({})]);
    expect(notice.incidents![0].status).toBe("notice");
    // Nothing broken: the page stays green.
    expect(notice.status).toBe("operational");
    // An impact on any component, or none given, is an incident.
    const hit = await read([post({ components: [{ ...station, impact: "PARTIAL_OUTAGE" }] }), post({ id: "n2", components: [{ component: station.component }] }), post({ id: "n3", components: [] })]);
    expect(hit.incidents!.map((i) => i.status)).toEqual(["triage", "triage", "triage"]);
    // Resolved, it reads as resolved like any other.
    const done = await read([post({ status: "RESOLVED", resolvedAt: "2026-10-25T08:00:00Z" })]);
    expect(done.incidents![0].status).toBe("resolved");
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

describe("instatus adapter", () => {
  const read = (h: string) =>
    readProvider({ slug: h, sourceKind: "instatus", sourceUrl: `https://${h}`, statusPageUrl: `https://${h}` }, makeGetter({}));

  it("reads components, history from RSS, and impact from the summary", async () => {
    const snap = await read("status.stytch.com");
    expect(snap.status).toBe("operational");
    expect(snap.components?.map((c) => c.name)).toContain("Live API");
    // Maintenance items are left out.
    expect(snap.incidents?.some((i) => /maintenance/i.test(i.title))).toBe(false);
    const sms = snap.incidents!.find((i) => i.externalId === "cmvjtpi4g00k71ms0l3d7zqcu")!;
    expect(sms.title).toBe("Missing or delayed SMS OTPs");
    expect(sms.impact).toBe("major");
    expect(sms.components).toEqual(["Message deliverability"]);
    expect(sms.startedAt.toISOString()).toBe("2026-10-22T16:00:12.000Z");
    expect(sms.monitoringAt?.toISOString()).toBe("2026-10-22T18:15:39.000Z");
    expect(sms.resolvedAt?.toISOString()).toBe("2026-10-22T18:29:01.000Z");
    expect(sms.updates.map((u) => u.status)).toEqual(["investigating", "monitoring", "resolved"]);
    expect(sms.updates[0].body).toMatch(/^We are investigating missing or delayed SMS OTPs/);
    expect(sms.url).toBe("https://status.stytch.com/incident/cmvjtpi4g00k71ms0l3d7zqcu");
  });

  it("dedupes repeated component names and drops group rows", async () => {
    const snap = await read("status.kinde.com");
    expect(snap.components?.some((c) => c.name === "AU region")).toBe(false);
    const i = snap.incidents!.find((x) => x.externalId === "cmueej0oo01g31arghodsxtd0")!;
    expect(i.components).toEqual(["Authentication", "Discord community", "Admin area"]);
    const pm = snap.incidents!.find((x) => x.externalId === "cmt8hez8g00h20ko4z88uijqa")!;
    expect(pm.postmortem).toBe(true);
    expect(pm.resolvedAt?.toISOString()).toBe("2026-08-25T09:46:00.000Z");
  });

  it("rolls an update past New Year into the next year", async () => {
    const { parseIsDescription } = await import("@/lib/adapters/instatus");
    const d = parseIsDescription(
      "Type: Incident\nAffected Components: API\nJan 1, 00:10:00 GMT+0 - Resolved - Fixed. Dec 31, 23:50:00 GMT+0 - Investigating - Looking.",
      new Date("2026-12-31T23:50:00Z"),
    );
    expect(d.updates.map((u) => u.postedAt.toISOString())).toEqual(["2026-12-31T23:50:00.000Z", "2027-01-01T00:10:00.000Z"]);
  });
});

describe("adapter edge cases", () => {
  const sp = { slug: "x", sourceKind: "statuspage" as const, sourceUrl: "https://x.test/", statusPageUrl: "https://x.test/" };
  const serve = (bodies: Record<string, unknown>) => async (url: string) => ({ notModified: false as const, body: bodies[new URL(url).pathname] });

  it("statuspage: a page with a component per city goes by incidents, not re-routed cities", async () => {
    const city = (id: string, name: string, status: string) => ({ id, name, status, group_id: "g" });
    const components = [
      { id: "g", name: "Africa", status: "partial_outage", group: true },
      city("a", "Accra, Ghana - (ACC)", "partial_outage"),
      city("b", "Annaba, Algeria - (AAE)", "major_outage"),
      { id: "w", name: "Workers", status: "operational" },
    ];
    const read = (summary: object) => readProvider(sp, serve({ "/api/v2/summary.json": { status: { indicator: "critical" }, components, ...summary }, "/api/v2/incidents.json": { incidents: [] } }));
    expect((await read({ incidents: [] })).status).toBe("operational");
    expect((await read({ incidents: [{ id: "i", name: "Access issues", status: "investigating", impact: "minor" }] })).status).toBe("degraded");
    expect((await read({ scheduled_maintenances: [{ status: "in_progress" }] })).status).toBe("maintenance");
    expect((await read({ scheduled_maintenances: [{ status: "scheduled" }] })).status).toBe("operational");
  });

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
