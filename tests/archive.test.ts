import { rm } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { incidents, providers } from "@/db/schema";
import { importArchives, toRwIncident } from "@/lib/archive";
import { pollAll } from "@/lib/poller";
import { fixtureDir, testDb } from "./helpers/db";

type Db = Awaited<ReturnType<typeof testDb>>["database"];
let database: Db;
let close: () => Promise<void>;
let fx: Awaited<ReturnType<typeof fixtureDir>>;

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

const railway = async () => (await database.select().from(providers).where(eq(providers.slug, "railway")))[0];

describe("railway archive", () => {
  it("an incident with no resolve note ends at its last update", () => {
    const r = toRwIncident({
      slug: "X",
      title: "t",
      components: [{ name: "Builds (EU West)", impact: "DEGRADED_PERFORMANCE" }, { name: "Builds (US West)", impact: "PARTIAL_OUTAGE" }],
      updates: [
        { status: "IDENTIFIED", at: "2026-09-23T14:13:00Z", message: "b" },
        { status: "INVESTIGATING", at: "2026-09-23T13:24:00Z", message: "a" },
      ],
    });
    expect(r).toMatchObject({ createdAt: "2026-09-23T13:24:00Z", resolvedAt: "2026-09-23T14:13:00Z", worstImpact: "PARTIAL_OUTAGE", status: "RESOLVED" });
  });

  it("fills 90 days, keeps the live incident open, and runs twice without changes", async () => {
    await pollAll(database, { slugs: ["railway"], now: new Date("2026-10-22T14:00:00Z") });
    const first = await importArchives(database);
    expect(first.inserted).toBeGreaterThan(20);
    expect(first.updated).toBe(0);

    const p = await railway();
    expect(p.historyFrom!.getTime()).toBeLessThanOrEqual(new Date("2026-07-24T00:00:00Z").getTime());
    const live = await database.select().from(incidents).where(and(eq(incidents.providerId, p.id), eq(incidents.externalId, "rw-1")));
    expect(live[0].resolvedAt).toBeNull();
    const builds = (await database.select().from(incidents).where(eq(incidents.externalId, "JUA1PC5H")))[0];
    expect(builds).toMatchObject({ origin: "backfill", url: "https://status.railway.com/incident/JUA1PC5H" });
    expect(builds.resolvedAt).toEqual(new Date("2026-10-20T20:56:00Z"));

    expect(await importArchives(database)).toEqual({ inserted: 0, updated: 0 });
  });
});
