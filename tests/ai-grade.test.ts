import { describe, expect, it } from "vitest";
import { applyVerdict, costMicros, inputHash, parseVerdict, renderIncident, type ReviewInput, type Verdict } from "@/lib/ai-grade";
import { finalGrade } from "@/lib/review";
import { classify } from "@/lib/severity";

const rules = classify({ title: "Elevated errors", impact: "major", components: ["Edge Network"], worstComponentStatus: "partial_outage" });

const verdict = (v: Partial<Verdict> = {}): Verdict => ({
  affected: [{ surface: "serving", tier: 2 }],
  not_counted: false,
  scope: "regional",
  security: false,
  data_loss: false,
  confidence: "high",
  rationale: "Requests failed in iad1 for 30 minutes.",
  summary: "Edge requests in iad1 returned errors for 30 minutes after a bad config push, fixed by a rollback.",
  recovered_at: null,
  ...v,
});

const incident: ReviewInput = {
  provider: "Vercel",
  category: "hosting",
  title: "Elevated errors",
  impact: "major",
  status: "resolved",
  startedAt: new Date("2026-10-01T10:00:00Z"),
  resolvedAt: new Date("2026-10-01T10:30:00Z"),
  components: ["Edge Network"],
  worstComponentStatus: "partial_outage",
  updates: [
    { status: "resolved", body: "Fixed.", postedAt: new Date("2026-10-01T10:30:00Z") },
    { status: "investigating", body: "Errors in iad1.", postedAt: new Date("2026-10-01T10:00:00Z") },
  ],
};

describe("applyVerdict", () => {
  it("lets a regional outage come down from Sev 1 to Sev 2", () => {
    expect(rules.tier).toBe(1);
    const g = applyVerdict(rules, verdict());
    expect(g).toMatchObject({ tier: 2, areaTiers: { production: 2 }, surfaces: ["serving"], scope: "regional", gradedBy: "claude" });
    expect(g.reason).toBe("Requests failed in iad1 for 30 minutes.");
  });

  it("keeps the rules' scope when Claude finds it unclear", () => {
    const local = classify({ title: "Elevated errors", impact: "major", components: ["Lisbon, Portugal - (LIS)"], worstComponentStatus: null });
    expect(applyVerdict(local, verdict({ scope: "unclear" })).scope).toBe("local");
    expect(applyVerdict(local, verdict({ scope: "global" })).scope).toBe("global");
  });

  it("takes the worst surface for the overall tier and the worst per area", () => {
    const g = applyVerdict(rules, verdict({ affected: [{ surface: "ship", tier: 3 }, { surface: "data", tier: 1 }, { surface: "serving", tier: 2 }] }));
    expect(g.tier).toBe(1);
    expect(g.areaTiers).toEqual({ shipping: 3, production: 1 });
  });

  it("counts a blocking dashboard or billing outage against SHIP and a papercut only overall", () => {
    expect(applyVerdict(rules, verdict({ affected: [{ surface: "manage", tier: 3 }] }))).toMatchObject({ tier: 3, areaTiers: { shipping: 3 } });
    expect(applyVerdict(rules, verdict({ affected: [{ surface: "manage", tier: 4 }] }))).toMatchObject({ tier: 4, areaTiers: {} });
    expect(applyVerdict(rules, verdict({ affected: [{ surface: "peripheral", tier: 4 }] }))).toMatchObject({ tier: 4, areaTiers: {} });
  });

  it("keeps a minor ship papercut (slower builds) out of SHIP", () => {
    expect(applyVerdict(rules, verdict({ affected: [{ surface: "ship", tier: 4 }] }))).toMatchObject({ tier: 4, areaTiers: {} });
  });

  it("grades security by impact and adds the penalty only for a compromise the text names", () => {
    const ddos = applyVerdict(rules, verdict({ affected: [{ surface: "serving", tier: 2 }], security: true }));
    expect(ddos).toMatchObject({ tier: 2, security: true, compromise: false });
    const breachRules = classify({ title: "Security incident", impact: "major", components: ["Edge Network"], worstComponentStatus: null, updateText: "Customers should rotate exposed credentials." });
    const breach = applyVerdict(breachRules, verdict({ affected: [{ surface: "ship", tier: 3 }], security: true }));
    expect(breach).toMatchObject({ tier: 3, security: true, compromise: true });
    expect(breach.reason).toMatch(/600 points for a security compromise/);
    // The words alone aren't enough: Claude has to call it a security incident.
    expect(applyVerdict(breachRules, verdict({ security: false })).compromise).toBe(false);
  });

  it("makes data loss Sev 1", () => {
    expect(applyVerdict(rules, verdict({ data_loss: true })).tier).toBe(1);
  });

  it("can mark an incident as not counted, a security advisory included, but never a breach", () => {
    expect(applyVerdict(rules, verdict({ not_counted: true, affected: [] })).tier).toBe(0);
    expect(applyVerdict(rules, verdict({ not_counted: true, affected: [], security: true })).tier).toBe(0);
    const breachRules = classify({ title: "Unauthorized access to some accounts", impact: "none", components: ["Edge Network"], worstComponentStatus: null });
    const sec = applyVerdict(breachRules, verdict({ not_counted: true, affected: [], security: true }));
    expect(sec).toMatchObject({ tier: 4, compromise: true });
    expect(sec.surfaces).toEqual(["serving"]);
  });

  it("flags low confidence for the review list", () => {
    expect(applyVerdict(rules, verdict({ confidence: "low" })).lowConfidence).toBe(true);
  });
});

describe("parseVerdict", () => {
  it("accepts a well-formed verdict", () => {
    expect(parseVerdict(verdict())).toEqual(verdict());
  });
  it("reads the recovery time, and treats empty or garbled as none", () => {
    expect(parseVerdict({ ...verdict(), recovered_at: "2026-10-22T22:49:00.000Z" })?.recovered_at?.toISOString()).toBe("2026-10-22T22:49:00.000Z");
    expect(parseVerdict({ ...verdict(), recovered_at: "" })?.recovered_at).toBeNull();
    expect(parseVerdict({ ...verdict(), recovered_at: "soon" })?.recovered_at).toBeNull();
    const { recovered_at: _, ...older } = verdict();
    expect(parseVerdict(older)?.recovered_at).toBeNull();
  });
  it.each([
    ["unknown surface", { affected: [{ surface: "vibes", tier: 2 }] }],
    ["tier out of range", { affected: [{ surface: "serving", tier: 0 }] }],
    ["nothing affected but counted", { affected: [] }],
    ["unknown scope", { scope: "planet" }],
    ["empty rationale", { rationale: " " }],
  ])("rejects %s", (_, patch) => {
    expect(parseVerdict({ ...verdict(), ...patch })).toBeNull();
  });
});

describe("finalGrade", () => {
  it("falls back to the rules when there is no usable verdict", () => {
    expect(finalGrade(rules, null)).toMatchObject({ tier: 1, gradedBy: "rules", scope: null });
    expect(finalGrade(rules, { junk: true })).toMatchObject({ tier: 1, gradedBy: "rules" });
    expect(finalGrade(rules, verdict())).toMatchObject({ tier: 2, gradedBy: "claude" });
  });
});

describe("renderIncident and inputHash", () => {
  it("orders updates oldest first and is stable", () => {
    const text = renderIncident(incident);
    expect(text.indexOf("Errors in iad1")).toBeLessThan(text.indexOf("Fixed."));
    expect(inputHash(text, "claude-haiku-5-5")).toBe(inputHash(renderIncident({ ...incident, updates: [...incident.updates].reverse() }), "claude-haiku-5-5"));
  });

  it("changes when the incident or the model changes", () => {
    const text = renderIncident(incident);
    expect(inputHash(text, "claude-haiku-5-5")).not.toBe(inputHash(text, "claude-sonnet-5-5"));
    expect(inputHash(renderIncident({ ...incident, status: "monitoring" }), "claude-haiku-5-5")).not.toBe(inputHash(text, "claude-haiku-5-5"));
  });

  it("keeps the first and latest updates of a very long incident", () => {
    const updates = Array.from({ length: 200 }, (_, k) => ({ status: "update", body: `note ${k} ${"x".repeat(200)}`, postedAt: new Date(Date.UTC(2026, 9, 1, 0, k)) }));
    const text = renderIncident({ ...incident, updates });
    expect(text).toContain("note 0 ");
    expect(text).toContain("note 199 ");
    expect(text).toMatch(/\[\d+ middle updates left out for length\]/);
    expect(text.length).toBeLessThan(14_000);
  });

  it("caps oversized fields so one hostile feed entry can't make a call expensive", () => {
    const huge = "y".repeat(1_000_000);
    const text = renderIncident({
      ...incident,
      title: huge,
      components: Array.from({ length: 5_000 }, (_, k) => `component ${k}`),
      updates: [
        { status: "investigating", body: huge, postedAt: new Date(Date.UTC(2026, 9, 1)) },
        { status: huge, body: huge, postedAt: new Date(Date.UTC(2026, 9, 1, 1)) },
      ],
    });
    expect(text.length).toBeLessThan(14_000);
    expect(text).toContain("[cut]");
  });
});

describe("costMicros", () => {
  it("prices Haiku 5.5 per million tokens, including cache reads and writes", () => {
    expect(costMicros("claude-haiku-5-5", { input_tokens: 1_000, output_tokens: 400 })).toBe(300);
    expect(costMicros("claude-haiku-5-5", { input_tokens: 1_000, output_tokens: 0, cache_read_input_tokens: 1_000, cache_creation_input_tokens: 1_000 })).toBe(235);
  });
  it("prices unknown models high so the budget errs safe", () => {
    expect(costMicros("some-new-model", { input_tokens: 1_000, output_tokens: 0 })).toBe(5_000);
  });
});
