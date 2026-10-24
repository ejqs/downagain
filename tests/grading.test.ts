import { describe, expect, it } from "vitest";
import { gradeFor, penaltyMinutes, score, type GradeInput } from "@/lib/grading";

const to = new Date("2026-10-22T00:00:00Z");
const from = new Date(to.getTime() - 90 * 86_400_000);
const at = (iso: string) => new Date(iso);

function inc(p: Partial<GradeInput> & { startedAt: Date }): GradeInput {
  return { monitoringAt: null, resolvedAt: null, tier: 1, tierOverride: null, areaTiers: { production: 1 }, surfaces: ["serving"], security: false, ...p };
}

describe("grades", () => {
  it("uses the documented cut-offs", () => {
    expect(gradeFor(0)).toBe("A+");
    expect(gradeFor(60)).toBe("A+");
    expect(gradeFor(61)).toBe("A");
    expect(gradeFor(900)).toBe("B");
    expect(gradeFor(2400)).toBe("C");
    expect(gradeFor(6000)).toBe("D");
    expect(gradeFor(6001)).toBe("F");
  });
});

describe("penaltyMinutes", () => {
  it("stops at monitoring", () => {
    const i = inc({ startedAt: at("2026-10-01T10:00:00Z"), monitoringAt: at("2026-10-01T10:30:00Z"), resolvedAt: at("2026-10-02T10:00:00Z") });
    expect(penaltyMinutes(i, from, to)).toBe(30);
  });
  it("clips to the window and caps forgotten incidents", () => {
    expect(penaltyMinutes(inc({ startedAt: at("2026-10-21T23:00:00Z") }), from, to)).toBe(60);
    expect(penaltyMinutes(inc({ startedAt: at("2026-09-01T00:00:00Z"), tier: 1 }), from, to)).toBe(72 * 60);
  });
  it("stops at the recovery Claude read, but only once the incident is resolved", () => {
    const base = { startedAt: at("2026-10-01T10:00:00Z"), recoveredAt: at("2026-10-01T12:00:00Z"), tier: 2 };
    expect(penaltyMinutes(inc({ ...base, resolvedAt: at("2026-10-01T20:00:00Z") }), from, to)).toBe(120);
    // Still open: the provider hasn't called it over, so neither do we.
    expect(penaltyMinutes(inc({ ...base, startedAt: at("2026-10-21T10:00:00Z"), recoveredAt: at("2026-10-21T12:00:00Z") }), from, to)).toBe(14 * 60);
    // Monitoring came first, or the timestamp is out of range: monitoring and resolve win.
    expect(penaltyMinutes(inc({ ...base, monitoringAt: at("2026-10-01T11:00:00Z"), resolvedAt: at("2026-10-01T20:00:00Z") }), from, to)).toBe(60);
    expect(penaltyMinutes(inc({ ...base, recoveredAt: at("2026-09-30T00:00:00Z"), resolvedAt: at("2026-10-01T11:00:00Z") }), from, to)).toBe(60);
  });
  it("caps anything short of Sev 1 at a day", () => {
    expect(penaltyMinutes(inc({ startedAt: at("2026-09-01T00:00:00Z"), tier: 2 }), from, to)).toBe(24 * 60);
    expect(penaltyMinutes(inc({ startedAt: at("2026-09-01T00:00:00Z"), tier: 1, tierOverride: 3 }), from, to)).toBe(24 * 60);
  });
});

describe("score", () => {
  it("a 2-hour Sev 1 is a C and costs 120 minutes of admitted uptime", () => {
    const s = score([inc({ startedAt: at("2026-10-01T10:00:00Z"), resolvedAt: at("2026-10-01T12:00:00Z") })], from, to);
    expect(s.points).toBe(1200);
    expect(s.grade).toBe("C");
    expect(s.sev1Minutes).toBe(120);
    expect(s.admittedUptime).toBeCloseTo(1 - 120 / (90 * 1440), 8);
    expect(s.areas.production.grade).toBe("C");
    expect(s.areas.shipping.grade).toBe("A+");
  });

  it("a Sev 1 in one region doesn't cost provider-wide uptime", () => {
    const s = score([inc({ startedAt: at("2026-10-01T10:00:00Z"), resolvedAt: at("2026-10-01T12:00:00Z"), scope: "regional" })], from, to);
    expect(s.admittedUptime).toBe(1);
    expect(s.sevCounts[0]).toBe(1);
    expect(s.points).toBe(360);
  });

  it("overlapping Sev 1s count once for uptime", () => {
    const s = score(
      [
        inc({ startedAt: at("2026-10-01T10:00:00Z"), resolvedAt: at("2026-10-01T11:00:00Z") }),
        inc({ startedAt: at("2026-10-01T10:30:00Z"), resolvedAt: at("2026-10-01T11:30:00Z") }),
      ],
      from,
      to,
    );
    expect(s.sev1Minutes).toBe(90);
    expect(s.incidentCount).toBe(2);
  });

  it("applies overrides and the security penalty", () => {
    const s = score(
      [inc({ startedAt: at("2026-10-01T10:00:00Z"), resolvedAt: at("2026-10-01T10:10:00Z"), tier: 1, tierOverride: 4, security: true, compromise: true })],
      from,
      to,
    );
    expect(s.points).toBe(Math.round(0.2 * 10 + 600));
    expect(s.sevCounts).toEqual([0, 0, 0, 1]);
    expect(s.sev1Minutes).toBe(0);
  });

  it("longest counts Sev 1-2 only", () => {
    const s = score(
      [
        inc({ startedAt: at("2026-10-01T00:00:00Z"), resolvedAt: at("2026-10-01T02:00:00Z"), tier: 2, areaTiers: { production: 2 } }),
        inc({ startedAt: at("2026-09-01T00:00:00Z"), resolvedAt: at("2026-09-20T00:00:00Z"), tier: 3, areaTiers: { shipping: 3 } }),
      ],
      from,
      to,
    );
    expect(s.longestMinutes).toBe(120);
    expect(score([inc({ startedAt: at("2026-10-01T00:00:00Z"), resolvedAt: at("2026-10-01T02:00:00Z"), tier: 4, areaTiers: { shipping: 4 } })], from, to).longestMinutes).toBe(0);
    // Still open, but began before the window: not a record for this window.
    expect(score([inc({ startedAt: at("2026-03-01T00:00:00Z"), resolvedAt: null, tier: 1 })], from, to).longestMinutes).toBe(0);
  });

  it("ignores not-counted and out-of-window incidents", () => {
    const s = score(
      [inc({ startedAt: at("2026-10-01T10:00:00Z"), resolvedAt: at("2026-10-01T11:00:00Z"), tier: 0 }), inc({ startedAt: at("2025-01-01T00:00:00Z"), resolvedAt: at("2025-01-01T01:00:00Z") })],
      from,
      to,
    );
    expect(s.incidentCount).toBe(0);
    expect(s.grade).toBe("A+");
  });
});

describe("area grades", () => {
  it("ignores area keys from before there were two areas", () => {
    const from = new Date("2026-07-01T00:00:00Z");
    const to = new Date("2026-10-01T00:00:00Z");
    const s = score(
      [{ startedAt: new Date("2026-09-01T00:00:00Z"), monitoringAt: null, resolvedAt: new Date("2026-09-01T01:00:00Z"), tier: 4, tierOverride: null, areaTiers: { dashboard: 4 } as never, surfaces: ["peripheral"], security: false }],
      from,
      to,
    );
    expect(Object.keys(s.areas)).toEqual(["production", "shipping"]);
    expect(s.points).toBe(12);
    expect(s.areas.shipping.points).toBe(0);
  });
});

describe("scope", () => {
  const from = new Date("2026-07-01T00:00:00Z");
  const to = new Date("2026-10-01T00:00:00Z");
  const hour = (scope: string | null) => ({
    startedAt: new Date("2026-09-01T00:00:00Z"),
    monitoringAt: null,
    resolvedAt: new Date("2026-09-01T01:00:00Z"),
    tier: 2,
    tierOverride: null,
    areaTiers: { production: 2 },
    surfaces: ["serving"],
    security: false,
    scope,
  });

  it("scales points by blast radius, overall and per area", () => {
    const pts = (scope: string | null) => score([hour(scope)], from, to);
    expect(pts(null).points).toBe(240);
    expect(pts("global").points).toBe(240);
    expect(pts("unclear").points).toBe(240);
    expect(pts("regional").points).toBe(72);
    expect(pts("subset").points).toBe(72);
    expect(pts("local").points).toBe(24);
    expect(pts("single").points).toBe(24);
    expect(pts("local").areas.production.points).toBeCloseTo(24);
  });

  it("never discounts the security penalty, and adds it only for a compromise", () => {
    expect(score([{ ...hour("local"), security: true, compromise: true }], from, to).points).toBe(624);
    expect(score([{ ...hour("local"), security: true }], from, to).points).toBe(24);
  });
});

describe("papercuts", () => {
  it("count overall but not in an area, even when stored with an area tier", () => {
    const s = score([inc({ startedAt: at("2026-10-01T00:00:00Z"), resolvedAt: at("2026-10-01T10:00:00Z"), tier: 4, areaTiers: { shipping: 4 }, surfaces: ["ship"] })], from, to);
    expect(s.points).toBe(120);
    expect(s.areas.shipping).toMatchObject({ points: 0, incidents: 0, downtimeMinutes: 0 });
  });
});
