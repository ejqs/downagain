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

  it("applies an override to the grouped name too", () => {
    const o = new Map([["Agent Runners", "peripheral" as const]]);
    expect(surfaceForComponent("Netlify Platform - Agent Runners", o, "hosting")).toBe("peripheral");
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

  it("grades security by impact; only a real compromise carries the penalty", () => {
    const c = classify({ ...base, title: "Security incident", components: ["Dashboard"] });
    expect(c).toMatchObject({ security: true, compromise: false, tier: 4 });
    expect(classify({ ...base, title: "CVE-2026-1234 in builders", components: ["Builds"] })).toMatchObject({ tier: 3, compromise: false });
    expect(classify({ ...base, title: "Mitigating a DDoS attack", impact: "major", components: ["Edge Network"], updateText: "malicious traffic" })).toMatchObject({ tier: 1, security: true, compromise: false });
    const breach = classify({ ...base, title: "x", impact: "minor", components: ["Builds"], updateText: "An unauthorized party accessed build logs. Please rotate your credentials." });
    expect(breach).toMatchObject({ tier: 3, security: true, compromise: true });
    expect(breach.reason).toMatch(/plus 600 points for a security compromise/);
    // Railway, Oct 21 2026: no "breach" word, but an attacker and every token revoked.
    const railway = "We strongly recommend that you revoke all environment variables stored in Railway. We are rotating all Railway bucket credentials. We have invalidated all Railway API tokens. Preliminary forensics on the intent of the attacker.";
    expect(classify({ ...base, title: "Railway Platform Outage", impact: "major", components: ["Builds"], updateText: railway }).compromise).toBe(true);
    expect(classify({ ...base, title: "Elevated errors", impact: "major", components: ["Builds"], updateText: "We are rotating TLS certificates on the edge." }).compromise).toBe(false);
  });

  it("a security incident in one cloud region stays at Sev 2, as Claude's grade does", () => {
    const c = classify({ title: "Security issue with EC2", impact: "minor", components: ["Amazon Elastic Compute Cloud"], worstComponentStatus: null, regions: ["us-east-1"], categorySlug: "cloud" });
    expect(c.security).toBe(true);
    expect(c.tier).toBe(2);
    expect(c.areaTiers.production).toBe(2);
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

describe("scope from the rules", () => {
  it("marks an incident confined to one named region as regional", () => {
    const one = classify({ title: "EC2 errors", impact: "major", components: ["Amazon Elastic Compute Cloud"], worstComponentStatus: null, regions: ["us-east-1"], categorySlug: "cloud" });
    expect(one.scope).toBe("regional");
    expect(classify({ title: "x", impact: "major", components: ["Edge Network"], worstComponentStatus: null }).scope).toBeNull();
  });

  it("reads the blast radius from the cities a network lists", () => {
    const at = (components: string[], title = "Elevated errors") => classify({ title, impact: "major", components, worstComponentStatus: null }).scope;
    expect(at(["Ashburn, VA, United States - (IAD)", "CDN/Cache"])).toBe("local");
    expect(at(["Ashburn, VA, United States - (IAD)", "North America - Ashburn, VA, United States - (IAD)"])).toBe("local");
    expect(at(["Portland, OR, United States - (PDX)", "Seattle, WA, United States - (SEA)"])).toBe("regional");
    const many = Array.from({ length: 11 }, (_, k) => `City ${k} - (C${String.fromCharCode(65 + k)}X)`);
    expect(at(many)).toBeNull();
  });

  it("counts a third-party carrier network as local", () => {
    const c = classify({ title: "SMS Delivery Delays from Twilio to Claro Costa Rica", impact: "minor", components: ["CARRIER NETWORK - SMS, Latin America"], worstComponentStatus: null, categorySlug: "apis" });
    expect(c).toMatchObject({ scope: "local", carrier: true });
    // Twilio's own product alongside: not just the carrier.
    expect(classify({ title: "x", impact: "minor", components: ["CARRIER NETWORK - SMS, Europe", "Programmable Messaging"], worstComponentStatus: null }).carrier).toBeUndefined();
  });

  it("marks some users as a subset", () => {
    expect(classify({ title: "Incorrect geo location for some Cloudflare WARP users", impact: "minor", components: ["WARP"], worstComponentStatus: null }).scope).toBe("subset");
    expect(classify({ title: "Increased HTTP 502 Errors", impact: "major", components: ["CDN/Cache"], worstComponentStatus: null }).scope).toBeNull();
  });
});

describe("database surfaces", () => {
  it.each([
    ["Database Operations", "ship"],
    ["Database Connectivity", "data"],
    ["Branching", "ship"],
    ["Management API", "ship"],
    ["Elevated Mgmt API Error Rates", "ship"],
    ["Project lifecycle operation errors", "ship"],
    ["Dashboard and API Requests", "manage"],
    ["CockroachDB Cloud Console", "manage"],
    ["Auth0", "manage"],
    ["Query Insights", "peripheral"],
    ["CockroachDB Telemetry", "peripheral"],
    ["us-east-1 (Northern Virginia)", "data"],
    ["us-central1 (Iowa)", "data"],
    ["AWS eu-central-1", "data"],
    ["Connection Pooler", "data"],
    ["Database Pay As You Go", "data"],
    ["QStash", "data"],
    ["CockroachDB Basic/Standard", "data"],
    ["Edge Functions", "serving"],
    ["Realtime", "serving"],
  ])("%s is %s", (name, surface) => {
    expect(surfaceForComponent(name, undefined, "databases")).toBe(surface);
  });

  const db = { ...base, categorySlug: "databases" };
  it("counts a database outage that breaks queries against PROD", () => {
    const c = classify({ ...db, title: "Connection errors", impact: "major", components: ["us-east-1 (Northern Virginia)"] });
    expect(c.tier).toBe(1);
    expect(c.areaTiers).toEqual({ production: 1 });
  });
  it("counts branching and new databases against SHIP", () => {
    const c = classify({ ...db, title: "New Database Creation Failing Due to Upstream Provider Issue", impact: "major" });
    expect(c.areaTiers).toEqual({ shipping: 3 });
    const b = classify({ ...db, title: "Delays", impact: "minor", components: ["Branching"] });
    expect(b.areaTiers).toEqual({ shipping: 3 });
  });
  it("reads Supabase Auth as production through its override", () => {
    const c = classify({ ...db, title: "Auth errors", impact: "major", components: ["Auth"] }, new Map([["Auth", "serving" as const]]));
    expect(c.areaTiers).toEqual({ production: 1 });
  });
});

describe("dev tools", () => {
  it.each([
    ["Git Operations", "ship"],
    ["Actions", "ship"],
    ["Pull Requests", "ship"],
    ["API Requests", "ship"],
    ["Webhooks", "ship"],
    ["Packages", "ship"],
    ["Package installation", "ship"],
    ["Registry", "ship"],
    ["Docker Hub Registry", "ship"],
    ["Pages", "serving"],
    ["Issues", "manage"],
    ["Codespaces", "manage"],
    ["Copilot", "peripheral"],
    ["www.npmjs.com website", "peripheral"],
  ])("%s is %s", (name, surface) => {
    expect(surfaceForComponent(name, undefined, "devtools")).toBe(surface);
  });

  it("grades a full Actions outage as SHIP, not PROD", () => {
    const c = classify({ ...base, categorySlug: "devtools", title: "Actions runs failing", impact: "critical", components: ["Actions"] });
    expect(c.tier).toBe(2);
    expect(c.areaTiers).toEqual({ shipping: 2 });
  });
});

describe("dev APIs", () => {
  it.each([
    ["Single Email", "serving"],
    ["SMTP", "serving"],
    ["Webhooks", "serving"],
    ["Authentication & User", "serving"],
    ["SMS, Latin America", "serving"],
    ["Media Delivery", "serving"],
    ["Upload API - EU", "serving"],
    ["Admin API - US", "ship"],
    ["API - Sandbox", "ship"],
    ["Platform API", "ship"],
    ["Ably Control API", "ship"],
    ["Events & Logs", "ship"],
    ["Debugger & Alarms", "ship"],
    ["Toll-Free Verification Portal", "ship"],
    ["Dashboard", "manage"],
    ["Control Panel", "manage"],
    ["Console", "manage"],
    ["Billing", "manage"],
    ["Accounts", "manage"],
    ["Website", "peripheral"],
    ["Documentation", "peripheral"],
    ["Stats and Analytics", "peripheral"],
    ["Marketing Website", "peripheral"],
  ])("%s is %s", (name, surface) => {
    expect(surfaceForComponent(name, undefined, "apis")).toBe(surface);
  });

  const api = { ...base, categorySlug: "apis" };
  it("counts an email sending outage against PROD", () => {
    const c = classify({ ...api, title: "Resend API with elevated error rate", impact: "minor", components: [] });
    expect(c.areaTiers).toEqual({ production: 2 });
  });
  it("counts a dashboard outage against SHIP, not PROD", () => {
    const c = classify({ ...api, title: "Seller dashboard logins are failing with timeouts", impact: "minor", components: [] });
    expect(c.surfaces).toEqual(["manage"]);
    expect(c.areaTiers.production).toBeUndefined();
  });
  it("reads Clerk Billing as production through its override", () => {
    const c = classify({ ...api, title: "Billing errors", impact: "major", components: ["Billing"] }, new Map([["Billing", "serving" as const]]));
    expect(c.areaTiers).toEqual({ production: 1 });
  });
});
