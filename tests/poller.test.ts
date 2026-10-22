import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { incidentUpdates, incidents, providerStatus, providers, rawSnapshots, statusChanges } from "@/db/schema";
import { pollAll } from "@/lib/poller";
import { regradeAll } from "@/lib/regrade";
import { seed } from "@/lib/seed";
import { fixtureDir, testDb } from "./helpers/db";

const SLUGS = ["vercel", "railway", "heroku"];
const T0 = new Date("2026-10-22T14:00:00Z");
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

type Db = Awaited<ReturnType<typeof testDb>>["database"];
let database: Db;
let close: () => Promise<void>;
let fx: Awaited<ReturnType<typeof fixtureDir>>;

const byslug = (rs: Awaited<ReturnType<typeof pollAll>>) => Object.fromEntries(rs.map((r) => [r.slug, r]));
const count = async (t: typeof statusChanges | typeof rawSnapshots | typeof incidents | typeof incidentUpdates) => (await database.select().from(t)).length;
async function pid(slug: string) {
  const [p] = await database.select().from(providers).where(eq(providers.slug, slug));
  return p;
}
async function incident(externalId: string) {
  const [i] = await database.select().from(incidents).where(eq(incidents.externalId, externalId));
  return i;
}
async function statusOf(slug: string) {
  const [s] = await database.select().from(providerStatus).where(eq(providerStatus.providerId, (await pid(slug)).id));
  return s;
}

beforeAll(async () => {
  ({ database, close } = await testDb());
  fx = await fixtureDir();
  process.env.STATUS_FIXTURES_DIR = fx.dir;
});
afterAll(async () => {
  delete process.env.STATUS_FIXTURES_DIR;
  await rm(fx.dir, { recursive: true, force: true });
  await close();
});

// The tests below run in order and share one database, like consecutive cron runs.
describe("poller", () => {
  it("seeding twice is a no-op", async () => {
    const before = (await database.select().from(providers)).length;
    await seed(database);
    expect((await database.select().from(providers)).length).toBe(before);
  });

  it("first poll stores status, incidents as backfill, and a raw snapshot", async () => {
    const r = byslug(await pollAll(database, { slugs: SLUGS, now: T0 }));
    expect(Object.keys(r).sort()).toEqual(["heroku", "railway", "vercel"]);
    for (const s of SLUGS) expect(r[s]).toMatchObject({ ok: true, changed: true });
    expect(r.vercel.status).toBe("degraded");
    expect(r.vercel.newIncidents).toBe(3);

    const open = await incident("inc-open");
    expect(open.origin).toBe("backfill");
    expect(open.tier).toBe(1);
    expect(open.firstSeenAt).toEqual(T0);
    expect((await database.select().from(incidentUpdates).where(eq(incidentUpdates.incidentId, open.id))).length).toBe(2);

    expect((await pid("vercel")).historyFrom).toEqual(new Date("2026-10-01T08:00:00Z"));
    expect(await count(statusChanges)).toBe(3);
    expect(await count(rawSnapshots)).toBe(3);
    expect((await statusOf("vercel")).since).toEqual(T0);
  });

  it("an unchanged poll writes nothing new and reports no change", async () => {
    const before = { changes: await count(statusChanges), raw: await count(rawSnapshots), incs: await count(incidents), ups: await count(incidentUpdates) };
    const updatedAt = (await incident("inc-open")).updatedAt;

    const rs = await pollAll(database, { slugs: SLUGS, now: min(5) });
    expect(rs.every((r) => r.ok && !r.changed && r.newIncidents === 0 && r.updatedIncidents === 0)).toBe(true);
    expect({ changes: await count(statusChanges), raw: await count(rawSnapshots), incs: await count(incidents), ups: await count(incidentUpdates) }).toEqual(before);
    expect((await incident("inc-open")).updatedAt).toEqual(updatedAt);

    const s = await statusOf("vercel");
    expect(s.lastCheckedAt).toEqual(min(5));
    expect(s.since).toEqual(T0); // status didn't move
  });

  it("a page timestamp alone is not a change", async () => {
    await fx.edit<{ page: { updated_at: string } }>("www.vercel-status.com__api_v2_summary.json", (j) => {
      j.page.updated_at = min(10).toISOString();
    });
    const r = byslug(await pollAll(database, { slugs: ["vercel"], now: min(10) }));
    expect(r.vercel.changed).toBe(false);
  });

  it("keeps a manual override when the incident is updated", async () => {
    await database.update(incidents).set({ tierOverride: 2, overrideNote: "edge city only" }).where(eq(incidents.externalId, "inc-open"));
    await regradeAll(database);
    expect((await incident("inc-open")).tierOverride).toBe(2);
  });

  it("records a resolution, a new update and a new live incident", async () => {
    const changesBefore = await count(statusChanges);
    await fx.edit<{ status: { indicator: string }; components: { status: string }[] }>("www.vercel-status.com__api_v2_summary.json", (j) => {
      j.status.indicator = "none";
      for (const c of j.components) c.status = "operational";
    });
    await fx.edit<{ incidents: Record<string, unknown>[] }>("www.vercel-status.com__api_v2_incidents.json", (j) => {
      const open = j.incidents[0] as { status: string; resolved_at: string; updated_at: string; incident_updates: unknown[] };
      open.status = "resolved";
      open.resolved_at = min(15).toISOString();
      open.updated_at = min(15).toISOString();
      open.incident_updates.unshift({ id: "u7", status: "resolved", body: "Fixed.", created_at: min(15).toISOString() });
      j.incidents.unshift({
        id: "inc-new",
        name: "Dashboard slow to load",
        status: "investigating",
        impact: "minor",
        created_at: min(14).toISOString(),
        updated_at: min(14).toISOString(),
        components: [{ id: "c3", name: "Dashboard", status: "degraded_performance" }],
        incident_updates: [{ id: "u8", status: "investigating", body: "Looking into it.", created_at: min(14).toISOString() }],
      });
    });

    const r = byslug(await pollAll(database, { slugs: SLUGS, now: min(15) }));
    expect(r.vercel).toMatchObject({ ok: true, changed: true, status: "operational", newIncidents: 1, updatedIncidents: 1 });
    expect(r.railway.changed).toBe(false);
    expect(r.heroku.changed).toBe(false);

    const open = await incident("inc-open");
    expect(open.resolvedAt).toEqual(min(15));
    expect(open.origin).toBe("backfill"); // kept from the first sighting
    expect(open.firstSeenAt).toEqual(T0);
    expect(open.tierOverride).toBe(2);
    expect((await database.select().from(incidentUpdates).where(eq(incidentUpdates.incidentId, open.id))).map((u) => u.externalId).sort()).toEqual(["u1", "u2", "u7"]);

    const fresh = await incident("inc-new");
    expect(fresh.origin).toBe("live");
    expect(fresh.tier).toBe(4);

    expect(await count(statusChanges)).toBe(changesBefore + 1);
    expect((await statusOf("vercel")).since).toEqual(min(15));
  });

  it("closes an incident that drops off a current-only feed", async () => {
    await fx.edit<{ incidents: unknown[]; components: { components?: { status: string }[] }[] }>("api.railwaystatus.com__status.json", (j) => {
      j.incidents = [];
      for (const g of j.components) for (const c of g.components ?? []) c.status = "OPERATIONAL";
    });
    const r = byslug(await pollAll(database, { slugs: ["railway"], now: min(20) }));
    expect(r.railway).toMatchObject({ changed: true, status: "operational", updatedIncidents: 1 });
    const rw = await incident("rw-1");
    expect(rw.resolvedAt).toEqual(min(20));
    expect(rw.status).toBe("resolved");
  });

  describe("when a status page stops answering", () => {
    const file = "status.heroku.com__api_v4_current-status.json";
    let saved: string;
    beforeAll(async () => {
      saved = await readFile(path.join(fx.dir, file), "utf8");
      await rm(path.join(fx.dir, file));
    });
    it("keeps the last status for a short blip", async () => {
      const r = byslug(await pollAll(database, { slugs: ["heroku"], now: min(25) }));
      expect(r.heroku).toMatchObject({ ok: false, changed: false, status: "major_outage" });
      expect((await statusOf("heroku")).fetchError).toBeTruthy();
    });

    it("goes unknown after 15 minutes without an answer", async () => {
      const before = await count(statusChanges);
      const r = byslug(await pollAll(database, { slugs: ["heroku"], now: min(16 + 15) }));
      expect(r.heroku).toMatchObject({ ok: false, changed: true, status: "unknown" });
      expect(await count(statusChanges)).toBe(before + 1);
    });

    it("counts coming back as a change", async () => {
      await writeFile(path.join(fx.dir, file), saved);
      const r = byslug(await pollAll(database, { slugs: ["heroku"], now: min(35) }));
      expect(r.heroku).toMatchObject({ ok: true, changed: true, status: "major_outage" });
      const s = await statusOf("heroku");
      expect(s.fetchError).toBeNull();
      expect(s.since).toEqual(min(35));
    });
  });

  it("a provider that has never answered stays hidden and quiet", async () => {
    const r = byslug(await pollAll(database, { slugs: ["netlify"], now: min(40) }));
    expect(r.netlify).toMatchObject({ ok: false, changed: false, status: "unknown" });
    expect((await statusOf("netlify")).lastOkAt).toBeNull();
  });

  it("refuses to run two polls at once", async () => {
    const first = pollAll(database, { slugs: ["vercel"], now: min(45) });
    await expect(pollAll(database, { slugs: ["vercel"], now: min(45) })).rejects.toThrow(/already running/);
    await first;
  });
});
