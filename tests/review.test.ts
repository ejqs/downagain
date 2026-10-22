import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { incidentReviews, incidentUpdates, incidents, providers } from "@/db/schema";
import { regradeAll } from "@/lib/regrade";
import { reviewPending, reviewSettings, type ReviewSettings } from "@/lib/review";
import { CLASSIFIER_VERSION } from "@/lib/severity";
import { testDb } from "./helpers/db";

let database: DB;
let close: () => Promise<void>;
let calls = 0;
let mode: "ok" | "down" | "refuse" = "ok";

// Stands in for the SDK client: only messages.create is used.
const client = {
  messages: {
    create: async () => {
      calls++;
      if (mode === "down") throw new Anthropic.APIConnectionError({ message: "connection reset" });
      if (mode === "refuse") return { stop_reason: "refusal", stop_details: { category: "general_harms" }, content: [], usage: { input_tokens: 800, output_tokens: 5 } };
      const verdict = { affected: [{ surface: "serving", tier: 2 }], not_counted: false, scope: "regional", security: false, data_loss: false, confidence: "high", rationale: "Errors in one region." };
      return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(verdict) }], usage: { input_tokens: 1000, output_tokens: 200 } };
    },
  },
} as unknown as Anthropic;

const settings: ReviewSettings = { enabled: true, model: "claude-haiku-5-5", monthlyBudgetMicros: 1_000_000 };
const NOW = new Date("2026-10-22T12:00:00Z");

async function addIncident(externalId: string, startedAt = new Date("2026-10-20T10:00:00Z")) {
  const [p] = await database.select().from(providers).where(eq(providers.slug, "vercel"));
  const [row] = await database
    .insert(incidents)
    .values({
      providerId: p.id,
      externalId,
      title: "Elevated errors",
      impact: "critical",
      status: "resolved",
      startedAt,
      resolvedAt: new Date(startedAt.getTime() + 3_600_000),
      components: ["Edge Network"],
      worstComponentStatus: "major_outage",
      origin: "live",
      tier: 1,
      areaTiers: { production: 1 },
      surfaces: ["serving"],
      reason: "Sev 1 because Edge Network had a major outage",
      classifierVersion: CLASSIFIER_VERSION,
      updatedAt: new Date("2026-10-21T00:00:00Z"),
    })
    .returning();
  await database.insert(incidentUpdates).values({ incidentId: row.id, externalId: `${externalId}-u1`, status: "investigating", body: "Errors in iad1.", postedAt: startedAt });
  return row.id;
}
const get = async (id: number) => (await database.select().from(incidents).where(eq(incidents.id, id)))[0];

beforeAll(async () => {
  ({ database, close } = await testDb());
});
afterAll(() => close());
beforeEach(async () => {
  calls = 0;
  mode = "ok";
  await database.delete(incidentReviews);
  await database.delete(incidentUpdates);
  await database.delete(incidents);
});

describe("reviewSettings", () => {
  it("is off without a key and has a kill switch", () => {
    expect(reviewSettings({}).enabled).toBe(false);
    expect(reviewSettings({ ANTHROPIC_API_KEY: "k" })).toMatchObject({ enabled: true, model: "claude-haiku-5-5", monthlyBudgetMicros: 5_000_000 });
    expect(reviewSettings({ ANTHROPIC_API_KEY: "k", AI_GRADING: "off" }).enabled).toBe(false);
    expect(reviewSettings({ ANTHROPIC_API_KEY: "k", AI_MONTHLY_BUDGET_USD: "0.5" }).monthlyBudgetMicros).toBe(500_000);
  });
});

describe("reviewPending", () => {
  it("does nothing when disabled", async () => {
    await addIncident("a");
    const r = await reviewPending(database, { client, settings: { ...settings, enabled: false } });
    expect(r).toMatchObject({ enabled: false, called: 0 });
    expect(calls).toBe(0);
  });

  it("stores Claude's grade and the review, then caches it", async () => {
    const id = await addIncident("a");
    const r = await reviewPending(database, { client, settings, now: NOW });
    expect(r).toMatchObject({ called: 1, failed: 0, changedProviders: ["vercel"] });
    expect(r.disagreements).toEqual([{ provider: "vercel", title: "Elevated errors", rules: 1, claude: 2, why: "Errors in one region." }]);
    expect(await get(id)).toMatchObject({ tier: 2, gradedBy: "claude", scope: "regional", reason: "Errors in one region.", reviewedHash: expect.any(String) });
    const [rev] = await database.select().from(incidentReviews);
    expect(rev).toMatchObject({ incidentId: id, rulesTier: 1, tier: 2, costMicros: 200, error: null });

    // Nothing changed: no new call.
    expect((await reviewPending(database, { client, settings, now: NOW })).called).toBe(0);

    // The poller rewrites the row with the rules grade (same content): applied from cache.
    await database.update(incidents).set({ tier: 1, gradedBy: "rules", updatedAt: new Date("2026-10-22T00:00:00Z") }).where(eq(incidents.id, id));
    const again = await reviewPending(database, { client, settings, now: NOW });
    expect(again).toMatchObject({ called: 0, fromCache: 1 });
    expect(await get(id)).toMatchObject({ tier: 2, gradedBy: "claude" });

    // A manual override still wins over Claude.
    await database.update(incidents).set({ tierOverride: 4 }).where(eq(incidents.id, id));
    expect((await get(id)).tierOverride).toBe(4);
  });

  it("caps calls per run and stops at the monthly budget, keeping the rules grade", async () => {
    for (const k of ["a", "b", "c"]) await addIncident(k);
    expect(await reviewPending(database, { client, settings, limit: 2, now: NOW })).toMatchObject({ called: 2, pendingLeft: true, stoppedBecause: "batch limit" });
    const broke = await reviewPending(database, { client, settings: { ...settings, monthlyBudgetMicros: 400 }, now: NOW });
    expect(broke).toMatchObject({ called: 0, stoppedBecause: "monthly budget" });
    const left = (await database.select().from(incidents)).filter((i) => i.gradedBy === "rules");
    expect(left).toHaveLength(1);
    expect(left[0].tier).toBe(1);
  });

  it("falls back to the rules on a refusal and doesn't retry that version", async () => {
    const id = await addIncident("a");
    mode = "refuse";
    expect(await reviewPending(database, { client, settings, now: NOW })).toMatchObject({ called: 1, failed: 1 });
    expect(await get(id)).toMatchObject({ tier: 1, gradedBy: "rules" });
    expect((await database.select().from(incidentReviews))[0].error).toBe("refusal: general_harms");
    expect((await reviewPending(database, { client, settings, now: NOW })).called).toBe(0);
  });

  it("leaves incidents pending when the API is down", async () => {
    const id = await addIncident("a");
    mode = "down";
    expect(await reviewPending(database, { client, settings, now: NOW })).toMatchObject({ called: 1, failed: 1, pendingLeft: true });
    expect(await get(id)).toMatchObject({ tier: 1, gradedBy: "rules", reviewedAt: null });
    mode = "ok";
    expect((await reviewPending(database, { client, settings, now: NOW })).called).toBe(1);
  });
});

describe("regradeAll", () => {
  it("keeps Claude's verdict for unchanged incidents and regrades stale rule versions", async () => {
    const reviewed = await addIncident("a");
    await reviewPending(database, { client, settings, now: NOW });
    const stale = await addIncident("b");
    await database.update(incidents).set({ classifierVersion: CLASSIFIER_VERSION - 1, tier: 3 }).where(eq(incidents.id, stale));

    expect(await regradeAll(database, { staleOnly: true })).toBe(1);
    expect(await get(stale)).toMatchObject({ tier: 1, classifierVersion: CLASSIFIER_VERSION });
    expect(await regradeAll(database, { staleOnly: true })).toBe(0);

    await regradeAll(database);
    expect(await get(reviewed)).toMatchObject({ tier: 2, gradedBy: "claude" });
  });
});
