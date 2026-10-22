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
      [inc({ startedAt: at("2026-10-01T10:00:00Z"), resolvedAt: at("2026-10-01T10:10:00Z"), tier: 1, tierOverride: 4, security: true })],
      from,
      to,
    );
    expect(s.points).toBe(Math.round(0.2 * 10 + 600));
    expect(s.sevCounts).toEqual([0, 0, 0, 1]);
    expect(s.sev1Minutes).toBe(0);
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
    expect(pts("local").areas.production.points).toBeCloseTo(24);
  });

  it("never discounts the security penalty", () => {
    expect(score([{ ...hour("local"), security: true }], from, to).points).toBe(624);
  });
});
