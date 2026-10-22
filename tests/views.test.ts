import { describe, expect, it } from "vitest";
import type { IncidentRow, ProviderRow, Snapshot } from "@/lib/data";
import { communication, dailyCells, daysSinceSev1, downNow, leaderboard, monthlyTrend, openIncidents, startHeatmap, topComponents, totals } from "@/lib/views";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-22T12:00:00Z");
const ago = (days: number, hours = 0) => NOW - days * DAY - hours * 3_600_000;

function prov(id: number, p: Partial<ProviderRow> = {}): ProviderRow {
  return {
    id,
    slug: `p${id}`,
    name: `Provider ${id}`,
    kind: null,
    category: "hosting",
    sortOrder: id,
    statusPageUrl: "https://status.example.com",
    homepageUrl: null,
    historyFrom: null,
    status: "operational",
    since: null,
    lastCheckedAt: NOW,
    components: [],
    ...p,
  };
}

let nextId = 1;
function inc(providerId: number, p: Partial<IncidentRow> & { startedAt: number }): IncidentRow {
  return {
    id: nextId++,
    providerId,
    title: "Something broke",
    impact: "major",
    status: "resolved",
    monitoringAt: null,
    resolvedAt: p.startedAt + 3_600_000,
    url: null,
    components: [],
    postmortem: false,
    origin: "live",
    tier: 1,
    tierOverride: null,
    areaTiers: { production: 1 },
    surfaces: ["serving"],
    security: false,
    reason: null,
    overrideNote: null,
    gradedBy: "rules",
    scope: null,
    ...p,
  };
}

const snap = (providers: ProviderRow[], incidents: IncidentRow[]): Snapshot => ({ generatedAt: NOW, categories: [], providers, incidents });

describe("downNow", () => {
  it("lists open incidents worst first, with a count of the rest", () => {
    const s = snap(
      [prov(1), prov(2)],
      [
        inc(1, { startedAt: ago(0, 2), resolvedAt: null, tier: 3, title: "Builds slow" }),
        inc(1, { startedAt: ago(0, 1), resolvedAt: null, tier: 2, title: "Edge errors" }),
        inc(2, { startedAt: ago(0, 3), resolvedAt: null, tier: 1, title: "Everything is down" }),
      ],
    );
    const d = downNow(s);
    expect(d.map((x) => x.provider.id)).toEqual([2, 1]);
    expect(d[1].title).toBe("Edge errors (+1 more)");
    expect(d[1].sinceMs).toBe(ago(0, 2)); // earliest open incident
  });

  it("falls back to the page status and names the broken components", () => {
    const p = prov(1, {
      status: "partial_outage",
      since: ago(0, 1),
      components: [
        { name: "API", status: "partial_outage" },
        { name: "Builds", status: "degraded" },
        { name: "Docs", status: "operational" },
      ],
    });
    expect(downNow(snap([p], []))).toEqual([expect.objectContaining({ title: "Problems reported on API, Builds", tier: 2, sinceMs: ago(0, 1) })]);
  });

  it("ignores maintenance, unknown, not-counted and resolved incidents", () => {
    const s = snap(
      [prov(1, { status: "maintenance" }), prov(2, { status: "unknown" }), prov(3)],
      [inc(3, { startedAt: ago(1), resolvedAt: null, tier: 0 }), inc(3, { startedAt: ago(1) })],
    );
    expect(downNow(s)).toEqual([]);
  });

  it("respects a manual override that zeroes an incident", () => {
    expect(openIncidents([inc(1, { startedAt: ago(0), resolvedAt: null, tierOverride: 0 })])).toEqual([]);
  });
});

describe("dailyCells", () => {
  it("marks each UTC day by its worst tier, oldest first", () => {
    const cells = dailyCells(
      [inc(1, { startedAt: ago(0, 1), tier: 4 }), inc(1, { startedAt: ago(2), tier: 1 }), inc(1, { startedAt: ago(2, -1), tier: 3 })],
      4,
      NOW,
    );
    expect(cells).toEqual(["up", "major", "up", "minor"]);
  });

  it("shows days before tracking began as no data", () => {
    expect(dailyCells([], 3, NOW, ago(1))).toEqual(["none", "up", "up"]);
  });

  it("paints every day an open incident spans", () => {
    expect(dailyCells([inc(1, { startedAt: ago(2), resolvedAt: null, tier: 2 })], 4, NOW)).toEqual(["up", "major", "major", "major"]);
  });
});

describe("leaderboard", () => {
  const s = snap(
    [prov(1, { name: "Calm" }), prov(2, { name: "Chaos" }), prov(3, { name: "Also calm" }), prov(4, { category: "ai" })],
    [inc(2, { startedAt: ago(5) }), inc(1, { startedAt: ago(5), tier: 4, areaTiers: {} })],
  );

  it("ranks worst first within a category", () => {
    expect(leaderboard(s, "hosting").map((r) => r.provider.name)).toEqual(["Chaos", "Calm", "Also calm"]);
    expect(leaderboard(s, "hosting", "best")[0].provider.name).toBe("Also calm");
  });

  it("gives every row 60 days of cells", () => {
    const rows = leaderboard(s, "hosting");
    expect(rows.every((r) => r.cells.length === 60)).toBe(true);
    expect(rows[0].score.grade).not.toBe("A+");
  });
});

describe("summaries", () => {
  it("counts days since the last Sev 1 ended", () => {
    expect(daysSinceSev1(snap([], [inc(1, { startedAt: ago(10) }), inc(1, { startedAt: ago(3), tier: 2 })]))).toBe(9);
    expect(daysSinceSev1(snap([], [inc(1, { startedAt: ago(1), resolvedAt: null })]))).toBe(0);
    expect(daysSinceSev1(snap([], []))).toBeNull();
  });

  it("totals incidents, Sev 1 minutes and DNS blame", () => {
    const t = totals(
      snap([prov(1)], [inc(1, { startedAt: ago(1), title: "DNS resolution failures" }), inc(1, { startedAt: ago(200) }), inc(1, { startedAt: ago(2), tier: 0 })]),
    );
    expect(t).toEqual({ incidents: 1, sev1Minutes: 60, providers: 1, dns: 1 });
  });

  it("buckets a 12-month trend", () => {
    const trend = monthlyTrend([inc(1, { startedAt: ago(1), tier: 2 }), inc(1, { startedAt: ago(1), tier: 3 })], NOW);
    expect(trend).toHaveLength(12);
    expect(trend.at(-1)).toEqual({ start: Date.UTC(2026, 9, 1), count: 2, worst: 2 });
    expect(trend[0]).toEqual({ start: Date.UTC(2025, 10, 1), count: 0, worst: 5 });
  });

  it("maps start times onto a Monday-first heatmap", () => {
    const grid = startHeatmap([inc(1, { startedAt: Date.parse("2026-10-19T03:15:00Z") })]); // a Monday
    expect(grid[0][3]).toBe(1);
    expect(grid.flat().reduce((a, b) => a + b)).toBe(1);
  });

  it("finds the most-broken components", () => {
    const list = [inc(1, { startedAt: ago(1), components: ["API", "Builds"] }), inc(1, { startedAt: ago(2), components: ["API"] })];
    expect(topComponents(list, 1)).toEqual([{ name: "API", count: 2 }]);
  });

  it("measures how a provider communicates", () => {
    const a = inc(1, { startedAt: ago(3), postmortem: true });
    const b = inc(1, { startedAt: ago(2), tier: 3, resolvedAt: ago(2) + 30 * 60_000 });
    const c = communication([a, b], {
      [a.id]: [{ postedAt: 0 }, { postedAt: 10 * 60_000 }, { postedAt: 40 * 60_000 }],
      [b.id]: [{ postedAt: 0 }],
    });
    expect(c).toEqual({ medianGapMinutes: 30, updatesPerIncident: 2, postmortems: 1, serious: 1, medianResolveMinutes: 60 });
  });
});
