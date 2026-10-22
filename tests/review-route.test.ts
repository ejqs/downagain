import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { incidentUpdates, incidents, providers } from "@/db/schema";
import type { DB } from "@/db";
import { reviewPending } from "@/lib/review";
import { testDb } from "./helpers/db";

const state = vi.hoisted(() => ({ database: null as unknown }));
vi.mock("@/db", async (orig) => ({ ...(await orig<typeof import("@/db")>()), db: () => state.database }));
vi.mock("next/cache", () => ({ unstable_cache: <T>(fn: T) => fn, revalidateTag: vi.fn() }));

const { GET } = await import("@/app/api/incidents/[id]/review/route");
const { getProviderHistory } = await import("@/lib/data");

const verdict = { affected: [{ surface: "serving", tier: 2 }], not_counted: false, scope: "regional", security: false, data_loss: false, confidence: "high", rationale: "Errors in iad1 only.", summary: "" };
const client = {
  messages: { create: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(verdict) }], usage: { input_tokens: 900, output_tokens: 150 } }) },
} as unknown as Anthropic;

let close: () => Promise<void>;
let id: number;
const get = (x: string) => GET(new Request(`http://localhost/api/incidents/${x}/review`), { params: Promise.resolve({ id: x }) });

beforeAll(async () => {
  const t = await testDb();
  state.database = t.database;
  close = t.close;
  const database = t.database as DB;
  const [p] = await database.select().from(providers).where(eq(providers.slug, "vercel"));
  const startedAt = new Date(Date.now() - 86_400_000);
  const [row] = await database
    .insert(incidents)
    .values({ providerId: p.id, externalId: "x", title: "Elevated errors", impact: "critical", status: "resolved", startedAt, resolvedAt: new Date(startedAt.getTime() + 3_600_000), components: ["Edge Network"], worstComponentStatus: "major_outage", origin: "live", tier: 1 })
    .returning();
  id = row.id;
  await database.insert(incidentUpdates).values({ incidentId: id, externalId: "u1", status: "investigating", body: "Errors in iad1.", postedAt: startedAt });
  await reviewPending(database, { client, settings: { enabled: true, model: "claude-haiku-5-5", monthlyBudgetMicros: 1_000_000 } });
});
afterAll(() => close());

describe("AI review trace", () => {
  it("serves the full audit record: rules vs Claude, what it read and what it answered", async () => {
    const res = await get(String(id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      incident: { id, provider: "vercel", gradedBy: "claude" },
      model: "claude-haiku-5-5",
      promptVersion: expect.any(Number),
      rules: { tier: 1, reason: expect.stringContaining("Edge Network") },
      claude: { tier: 2, verdict: { rationale: "Errors in iad1 only." }, error: null },
      rawOutput: JSON.stringify(verdict),
    });
    expect(body.input).toContain("Errors in iad1.");
  });

  it("404s for incidents without an AI review and for junk ids", async () => {
    expect((await get("999999")).status).toBe(404);
    expect((await get("abc")).status).toBe(404);
  });

  it("puts the trace on provider history for the page", async () => {
    const h = await getProviderHistory("vercel");
    expect(h?.reviews[id]).toMatchObject({ model: "claude-haiku-5-5", rulesTier: 1, tier: 2 });
  });
});
