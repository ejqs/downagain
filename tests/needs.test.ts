import { describe, expect, it } from "vitest";
import type { IncidentRow, Snapshot } from "@/lib/data";
import { applyFilter, filterQuery, incidentFits, parseFilter, toggleNeed } from "@/lib/needs";

const NOW = Date.parse("2026-10-22T12:00:00Z");
let nextId = 1;
function inc(p: Partial<IncidentRow>): IncidentRow {
  return {
    id: nextId++,
    providerId: 1,
    title: "Something broke",
    impact: "major",
    status: "resolved",
    startedAt: NOW - 86_400_000,
    monitoringAt: null,
    resolvedAt: NOW - 82_800_000,
    url: null,
    components: [],
    postmortem: false,
    origin: "live",
    tier: 2,
    tierOverride: null,
    areaTiers: { production: 2 },
    surfaces: ["serving"],
    security: false,
    reason: null,
    overrideNote: null,
    gradedBy: "rules",
    scope: null,
    summary: null,
    stale: false,
    ...p,
  };
}

const sgPgStorage = parseFilter({ need: "postgres,storage", region: "sg" });

describe("parseFilter", () => {
  it("reads needs and a region, drops unknown keys", () => {
    const f = parseFilter({ need: ["postgres,nope", "storage"], region: "SG" });
    expect(f.needs.map((n) => n.key)).toEqual(["postgres", "storage"]);
    expect(f.region?.label).toBe("Singapore");
    expect(filterQuery(f)).toBe("need=postgres,storage&region=sg");
    expect(filterQuery(parseFilter({}))).toBe("");
  });

  it("keeps only what the category offers", () => {
    expect(parseFilter({ need: "postgres,llm", region: "sg" }, "ai")).toEqual({ needs: [expect.objectContaining({ key: "llm" })], region: null });
  });

  it("toggles one need", () => {
    expect(filterQuery(toggleNeed(sgPgStorage, "storage"))).toBe("need=postgres&region=sg");
    expect(filterQuery(toggleNeed(sgPgStorage, "compute"))).toBe("need=compute,postgres,storage&region=sg");
  });
});

describe("incidentFits: Singapore, Postgres and storage", () => {
  const fits = (p: Partial<IncidentRow>) => incidentFits(inc(p), sgPgStorage);

  it("leaves out what names something else", () => {
    expect(fits({ title: "Agent Runners degraded", components: ["Agent Runners"], surfaces: ["peripheral"] })).toBe(false);
    expect(fits({ title: "Builds delayed", components: ["Builds"], surfaces: ["ship"] })).toBe(false);
  });

  it("keeps what names a picked need", () => {
    expect(fits({ title: "Slow queries", components: ["Database"], surfaces: ["data"] })).toBe(true);
    expect(fits({ title: "Uploads failing", components: ["Storage Buckets (Southeast Asia)"], surfaces: ["data"] })).toBe(true);
    // No components: the title decides.
    expect(fits({ title: "Postgres connection errors", surfaces: ["data"] })).toBe(true);
  });

  it("leaves out another region, keeps Singapore and global incidents", () => {
    expect(fits({ title: "Database errors in us-east-1", surfaces: ["data"] })).toBe(false);
    expect(fits({ title: "Database errors", regions: ["eu-west-1"], surfaces: ["data"] })).toBe(false);
    expect(fits({ title: "Storage degraded", components: ["Storage (US West)", "Storage (Southeast Asia)"], surfaces: ["data"] })).toBe(true);
    expect(fits({ title: "Database errors in ap-southeast-1", surfaces: ["data"] })).toBe(true);
    expect(fits({ title: "Database errors across APAC", surfaces: ["data"] })).toBe(true);
    expect(fits({ title: "Database errors", surfaces: ["data"] })).toBe(true);
  });

  it("judges an incident that names nothing by the surface it hit", () => {
    expect(fits({ title: "Elevated error rates", surfaces: ["data"] })).toBe(true);
    expect(fits({ title: "Elevated error rates", surfaces: ["peripheral"] })).toBe(false);
    expect(fits({ title: "Elevated error rates", surfaces: null })).toBe(true);
  });
});

describe("incidentFits: LLM API", () => {
  const f = parseFilter({ need: "llm" });
  it("counts the API, not the consumer apps", () => {
    expect(incidentFits(inc({ title: "Elevated errors on Responses API" }), f)).toBe(true);
    expect(incidentFits(inc({ title: "ChatGPT unavailable for some users", surfaces: ["peripheral"] }), f)).toBe(false);
    expect(incidentFits(inc({ title: "Sora video generation delayed", surfaces: ["peripheral"] }), f)).toBe(false);
  });
});

describe("applyFilter", () => {
  it("keeps every provider and only the fitting incidents", () => {
    const snap: Snapshot = {
      generatedAt: NOW,
      categories: [],
      providers: [],
      incidents: [inc({ title: "Database down", surfaces: ["data"] }), inc({ title: "Builds slow", components: ["Builds"], surfaces: ["ship"] })],
    };
    expect(applyFilter(snap, sgPgStorage).incidents.map((i) => i.title)).toEqual(["Database down"]);
    expect(applyFilter(snap, parseFilter({}))).toBe(snap);
  });
});
