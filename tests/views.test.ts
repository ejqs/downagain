import { describe, expect, it } from "vitest";
import type { IncidentRow, ProviderRow, Snapshot } from "@/lib/data";
import { brokenComponents, coveredDays, liveLevel, communication, dailyCells, valueBoard, dailyLoad, heatLevel, daysSinceSev1, downNow, leaderboard, monthlyTrend, openIncidents, startHeatmap, topComponents, totals } from "@/lib/views";

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
    summary: null,
    stale: false,
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

  it("leaves out incidents open for over a week, and the page status they hold red", () => {
    const p = prov(1, { status: "degraded", components: [{ name: "ME-SOUTH-1", status: "major_outage" }] });
    const stale = inc(1, { startedAt: ago(200), resolvedAt: null, tier: 1, title: "Region Availability" });
    expect(downNow(snap([p], [stale]))).toEqual([]);
    const fresh = inc(1, { startedAt: ago(0, 1), resolvedAt: null, tier: 2, title: "Elevated errors" });
    expect(downNow(snap([p], [stale, fresh]))).toEqual([expect.objectContaining({ title: "Elevated errors", tier: 2 })]);
  });

  it("leaves out a provider whose only open incident is a Sev 4 papercut", () => {
    const p = prov(1, { status: "degraded", components: [{ name: "Logs", status: "degraded" }] });
    expect(downNow(snap([p], [inc(1, { startedAt: ago(0, 1), resolvedAt: null, tier: 4 })]))).toEqual([]);
  });
});

describe("brokenComponents", () => {
  it("counts by status and by group, worst first", () => {
    const p = prov(1, {
      components: [
        { name: "Accra", group: "Africa", status: "degraded" },
        { name: "Arica", group: "Latin America", status: "major_outage" },
        { name: "Annaba", group: "Africa", status: "major_outage" },
        { name: "Sydney", group: "Oceania", status: "degraded" },
        { name: "API", status: "operational" },
      ],
    });
    const b = brokenComponents(p);
    expect(b.items.map((c) => c.name)).toEqual(["Annaba", "Arica", "Accra", "Sydney"]);
    expect(b.byStatus).toEqual([["major_outage", 2], ["degraded", 2]]);
    expect(b.groups).toEqual([["Africa", 2], ["Latin America", 1], ["Oceania", 1]]);
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

  it("stops painting a long-open incident after a week", () => {
    const cells = dailyCells([inc(1, { startedAt: ago(30), resolvedAt: null, tier: 1 })], 30, NOW);
    expect(cells.filter((c) => c === "major")).toHaveLength(7);
    expect(cells.at(-1)).toBe("up");
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

  it("lists providers with under 14 days of data last, ungraded, both ways round", () => {
    const t = snap(
      [prov(1, { name: "Old", historyFrom: ago(200) }), prov(2, { name: "New", trackedFrom: ago(3) }), prov(3, { name: "Busy", historyFrom: ago(20), trackedFrom: ago(1) })],
      [inc(3, { startedAt: ago(5) })],
    );
    const rows = leaderboard(t, "hosting");
    expect(rows.map((r) => [r.provider.name, r.graded, r.covered])).toEqual([
      ["Busy", true, 20],
      ["Old", true, 90],
      ["New", false, 3],
    ]);
    expect(leaderboard(t, "hosting", "best").map((r) => r.provider.name)).toEqual(["Old", "Busy", "New"]);
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
    expect(t).toEqual({ incidents: 1, sev1: 1, sev1Minutes: 60, providers: 1, dns: 1 });
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

describe("dailyLoad", () => {
  it("weights each UTC day by severity x minutes, splitting incidents across midnight", () => {
    const days = dailyLoad(
      [
        inc(1, { startedAt: ago(1, 2), tier: 1 }), // 1h Sev 1 yesterday
        inc(2, { startedAt: ago(2, 13), resolvedAt: ago(2, 11), tier: 3 }), // 23:00 to 01:00
        inc(1, { startedAt: ago(5), tier: 0 }), // not counted
      ],
      4,
      NOW,
    );
    expect(days.map((d) => d.points)).toEqual([60, 60, 600, 0]);
    expect(days.map((d) => d.incidents)).toEqual([1, 1, 1, 0]);
    expect(days[2].worst).toBe(1);
    expect(days[3].worst).toBe(5);
    expect(days[3].day).toBe(Math.floor(NOW / DAY) * DAY);
  });

  it("adds the security penalty once, on the start day, and runs open incidents up to now", () => {
    const days = dailyLoad([inc(1, { startedAt: ago(1, 0), resolvedAt: null, tier: 2, security: true })], 3, NOW);
    expect(days[0].points).toBe(0);
    expect(days[1].points).toBe(4 * 12 * 60 + 600); // 12:00 to midnight
    expect(days[2].points).toBe(4 * 12 * 60); // midnight to now
  });

  it("colours a day by its worst tier and keeps that day's worst incident", () => {
    expect([1, 2, 3, 4, 5].map(heatLevel)).toEqual([3, 2, 1, 1, 0]);
    const short = inc(1, { startedAt: ago(0, 3), resolvedAt: ago(0, 2.5), tier: 1 });
    const long = inc(2, { startedAt: ago(0, 4), resolvedAt: ago(0, 1), tier: 1 });
    const minor = inc(3, { startedAt: ago(0, 5), tier: 3 });
    const [today] = dailyLoad([short, minor, long], 1, NOW);
    expect(today.top?.id).toBe(long.id);
    expect(dailyLoad([], 1, NOW)[0].top).toBeNull();
  });
});

describe("liveLevel", () => {
  it("calls only Sev 1 or a major outage down", () => {
    expect(liveLevel({ tier: 1, status: "degraded" })).toBe("down");
    expect(liveLevel({ tier: 2, status: "major_outage" })).toBe("down");
    expect(liveLevel({ tier: 2, status: "degraded" })).toBe("issues");
    expect(liveLevel({ tier: 3, status: "operational" })).toBe("issues");
  });
});

describe("coverage", () => {
  it("counts from the older of first poll and oldest incident, capped at the window", () => {
    expect(coveredDays(prov(1, { historyFrom: ago(40), trackedFrom: ago(2) }), NOW)).toBe(40);
    expect(coveredDays(prov(1, { historyFrom: null, trackedFrom: ago(2) }), NOW)).toBe(2);
    expect(coveredDays(prov(1, { historyFrom: ago(400) }), NOW)).toBe(90);
  });

  it("keeps ungraded providers off the best-value frontier", () => {
    const t = snap([prov(1, { slug: "azure", category: "cloud", trackedFrom: ago(1) }), prov(2, { slug: "aws", category: "cloud", historyFrom: ago(300) })], []);
    const rows = valueBoard(t, "cloud");
    expect(rows.find((r) => r.provider.slug === "azure")!.bestValue).toBe(false);
    expect(rows.find((r) => r.provider.slug === "aws")!.bestValue).toBe(true);
  });
});

describe("gradeCauses", () => {
  it("ranks incidents by the points they cost, with their share", async () => {
    const { gradeCauses } = await import("@/lib/views");
    const long = inc(1, { title: "long", startedAt: ago(5), resolvedAt: ago(5) + 3 * 3_600_000 });
    const short = inc(1, { title: "short", startedAt: ago(3), resolvedAt: ago(3) + 3_600_000 });
    const old = inc(1, { title: "old", startedAt: ago(120) });
    const c = gradeCauses(snap([prov(1)], [short, long, old]), 1, 1);
    expect(c.top.map((x) => x.incident.title)).toEqual(["long"]);
    expect(c.top[0].share).toBeCloseTo(0.75);
    expect(c.rest).toBe(1);
  });
});

describe("narrowed views", () => {
  it("grade only the focused areas and skip status-only live tags", async () => {
    const { downNow, scoreFor } = await import("@/lib/views");
    const ship = inc(1, { startedAt: ago(2), resolvedAt: ago(2) + 10 * 3_600_000, tier: 3, areaTiers: { shipping: 3 }, surfaces: ["ship"] });
    const base = snap([prov(1, { status: "major_outage" })], [ship]);
    const focused = { ...base, focus: { areas: ["production" as const] } };
    expect(scoreFor(base, 1).grade).not.toBe("A+");
    expect(scoreFor(focused, 1).grade).toBe("A+");
    expect(downNow(base)).toHaveLength(1);
    expect(downNow(focused)).toHaveLength(0);
  });
});
