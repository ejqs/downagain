import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { incidents, providerStatus, providers } from "@/db/schema";
import { pollAll } from "@/lib/poller";
import { fixtureDir, testDb } from "./helpers/db";

const SLUGS = ["aws", "gcp", "azure"];
const T0 = new Date("2026-10-22T15:00:00Z");
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

type Db = Awaited<ReturnType<typeof testDb>>["database"];
let database: Db;
let close: () => Promise<void>;
let fx: Awaited<ReturnType<typeof fixtureDir>>;

const byslug = (rs: Awaited<ReturnType<typeof pollAll>>) => Object.fromEntries(rs.map((r) => [r.slug, r]));
async function incident(externalId: string) {
  const [i] = await database.select().from(incidents).where(eq(incidents.externalId, externalId));
  return i;
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

describe("polling the clouds", () => {
  it("backfills each feed's history with regions and regional grades", async () => {
    const r = byslug(await pollAll(database, { slugs: SLUGS, now: T0 }));
    expect(r.aws).toMatchObject({ ok: true, status: "degraded", newIncidents: 4 });
    expect(r.gcp).toMatchObject({ ok: true, status: "degraded", newIncidents: 3 });
    expect(r.azure).toMatchObject({ ok: true, status: "degraded", newIncidents: 2 });

    const uae = (await database.select().from(incidents).where(eq(incidents.status, "investigating"))).find((i) => i.regions?.includes("me-central-1"))!;
    expect(uae).toMatchObject({ regions: ["me-central-1"], tier: 2, origin: "backfill" });
    expect(uae.reason).toMatch(/held to Sev 2 as only me-central-1 was hit/);

    expect(await incident("gcpGlobalOutage")).toMatchObject({ regions: null, tier: 1 });
    expect(await incident("gcpOpenRegional")).toMatchObject({ regions: ["us-central1"], tier: 2 });

    const [gcp] = await database.select().from(providers).where(eq(providers.slug, "gcp"));
    expect(gcp.historyFrom).toEqual(new Date("2026-08-10T08:00:00Z"));
  });

  it("an unchanged poll is not a change", async () => {
    const rs = await pollAll(database, { slugs: SLUGS, now: min(5) });
    expect(rs.every((r) => r.ok && !r.changed && r.newIncidents === 0 && r.updatedIncidents === 0)).toBe(true);
  });

  it("regrades an incident when its regions change and nothing else does", async () => {
    await fx.edit<{ id: string; previously_affected_locations: { id: string; title: string }[] }[]>("status.cloud.google.com__incidents.json", (list) => {
      list.find((i) => i.id === "gcpOpenRegional")!.previously_affected_locations.push({ id: "us-east1", title: "South Carolina (us-east1)" });
    });
    const r = byslug(await pollAll(database, { slugs: ["gcp"], now: min(7) }));
    expect(r.gcp).toMatchObject({ changed: true, updatedIncidents: 1 });
    expect(await incident("gcpOpenRegional")).toMatchObject({ regions: ["us-central1", "us-east1"], tier: 1 });
  });

  it("closes an Azure incident when its item leaves the feed", async () => {
    await writeFile(path.join(fx.dir, "azure.status.microsoft__en-us_status_feed.xml"), '<?xml version="1.0"?><rss version="2.0"><channel><title>Azure Status</title></channel></rss>');
    const r = byslug(await pollAll(database, { slugs: ["azure"], now: min(10) }));
    expect(r.azure).toMatchObject({ changed: true, status: "operational", updatedIncidents: 2 });
    expect(await incident("azure-fd-eus2")).toMatchObject({ status: "resolved", resolvedAt: min(10) });
    const [s] = await database
      .select()
      .from(providerStatus)
      .innerJoin(providers, eq(providers.id, providerStatus.providerId))
      .where(eq(providers.slug, "azure"));
    expect(s.provider_status.components).toEqual([]);
  });
});
