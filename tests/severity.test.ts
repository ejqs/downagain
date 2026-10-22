import { describe, expect, it } from "vitest";
import { classify, surfaceForComponent } from "@/lib/severity";

const base = { impact: "minor" as const, worstComponentStatus: null, components: [] as string[] };

describe("surfaceForComponent", () => {
  it.each([
    ["Edge Network", "serving"],
    ["iad1 - Washington, D.C., USA", "serving"],
    ["Builds", "ship"],
    ["Deployments", "ship"],
    ["Machines API", "ship"],
    ["Persistent Storage (Volumes)", "data"],
    ["Postgres", "data"],
    ["Dashboard", "manage"],
    ["Payments & Billing", "manage"],
    ["Documentation", "peripheral"],
    ["ChatGPT", "peripheral"],
    ["Chat Completions", "serving"],
    ["Fine-tuning", "ship"],
  ])("%s → %s", (name, surface) => {
    expect(surfaceForComponent(name)).toBe(surface);
  });

  it("treats a hosting provider's bare API as the control plane", () => {
    expect(surfaceForComponent("API — backboard.railway.com", undefined, "hosting")).toBe("ship");
    expect(surfaceForComponent("Claude API (api.anthropic.com)", undefined, "ai")).toBe("serving");
  });

  it("lets overrides win", () => {
    expect(surfaceForComponent("Live", new Map([["Live", "peripheral"]]))).toBe("peripheral");
  });
});

describe("classify", () => {
  it("production partial outage is Sev 1", () => {
    const c = classify({ ...base, title: "Errors", impact: "major", components: ["Edge Network"] });
    expect(c.tier).toBe(1);
    expect(c.areaTiers).toEqual({ production: 1 });
    expect(c.reason).toBe("Sev 1 because Edge Network had a partial outage");
  });

  it("production degraded is Sev 2", () => {
    expect(classify({ ...base, title: "Slow", components: ["Edge Network"] }).tier).toBe(2);
  });

  it("builds are Sev 3 unless fully down", () => {
    expect(classify({ ...base, title: "Builds slow", impact: "major", components: ["Builds"] }).tier).toBe(3);
    expect(classify({ ...base, title: "Builds down", impact: "critical", components: ["Builds"] }).tier).toBe(2);
  });

  it("a slow dashboard is a papercut that only counts overall", () => {
    const c = classify({ ...base, title: "Dashboard slow", components: ["Dashboard"] });
    expect(c.tier).toBe(4);
    expect(c.areaTiers).toEqual({});
  });

  it("a dashboard, auth or billing outage counts against shipping", () => {
    const c = classify({ ...base, title: "Dashboard unavailable", impact: "major", components: ["Dashboard"] });
    expect(c).toMatchObject({ tier: 3, areaTiers: { shipping: 3 } });
  });

  it("docs stay a papercut even when fully down", () => {
    const c = classify({ ...base, title: "Docs down", impact: "critical", components: ["Documentation"] });
    expect(c).toMatchObject({ tier: 4, areaTiers: {} });
  });

  it("grades by impact: a minor billing issue that froze accounts can't ship", () => {
    const c = classify({ ...base, title: "Billing issue", components: ["Payments & Billing"], updateText: "Some accounts were suspended after failed card charges." });
    expect(c).toMatchObject({ tier: 3, areaTiers: { shipping: 3 } });
    const docs = classify({ ...base, title: "Docs search broken", components: ["Documentation"], updateText: "Users are unable to deploy from the docs quickstart button." });
    expect(docs).toMatchObject({ tier: 3, areaTiers: { shipping: 3 } });
  });

  it("uses component statuses when worse than the impact field", () => {
    expect(classify({ ...base, title: "x", impact: "none", worstComponentStatus: "major_outage", components: ["Builds"] }).tier).toBe(2);
  });

  it("takes the worst surface and grades each area", () => {
    const c = classify({ ...base, title: "x", impact: "major", components: ["Builds", "Dashboard", "Postgres"] });
    expect(c.tier).toBe(1);
    expect(c.areaTiers).toEqual({ shipping: 3, production: 1 });
  });

  it("security bumps one tier with Sev 2 as the floor", () => {
    const c = classify({ ...base, title: "Security incident", components: ["Dashboard"] });
    expect(c.security).toBe(true);
    expect(c.tier).toBe(2);
    expect(classify({ ...base, title: "CVE-2026-1234 in builders", components: ["Builds"] }).tier).toBe(2);
    expect(classify({ ...base, title: "x", impact: "critical", components: ["Edge Network"], updateText: "unauthorized access" }).tier).toBe(1);
  });

  it("data loss is always Sev 1", () => {
    const c = classify({ ...base, title: "Volume issue", components: ["Dashboard"], updateText: "Some data was lost" });
    expect(c.tier).toBe(1);
  });

  it("falls back to the title with low confidence", () => {
    const c = classify({ ...base, title: "Deploys failing", components: [] });
    expect(c.tier).toBe(3);
    expect(c.lowConfidence).toBe(true);
  });

  it("does not count scheduled maintenance", () => {
    expect(classify({ ...base, impact: "none", title: "Scheduled maintenance for databases" }).tier).toBe(0);
  });
});
