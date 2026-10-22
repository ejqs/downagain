import { describe, expect, it } from "vitest";
import { toIncidentRow } from "@/lib/data";
import { STALE_OPEN_DAYS, staleEnd } from "@/lib/grading";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-22T16:50:00Z");

function row(p: { startedAt: string; resolvedAt?: string; sourceUpdatedAt?: string; lastUpdateAt?: string }) {
  return {
    id: 1,
    providerId: 1,
    title: "t",
    impact: "major",
    status: "monitoring",
    startedAt: new Date(p.startedAt),
    monitoringAt: null,
    resolvedAt: p.resolvedAt ? new Date(p.resolvedAt) : null,
    url: null,
    components: [],
    postmortem: false,
    origin: "backfill",
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
    sourceUpdatedAt: p.sourceUpdatedAt ? new Date(p.sourceUpdatedAt) : null,
    lastUpdateAt: p.lastUpdateAt ?? null,
  } as Parameters<typeof toIncidentRow>[0];
}

describe("incidents left open by the provider", () => {
  it("stay live for a week after the last update", () => {
    expect(staleEnd(NOW - (STALE_OPEN_DAYS - 1) * DAY, NOW)).toBeNull();
    expect(staleEnd(NOW - (STALE_OPEN_DAYS + 1) * DAY, NOW)).toBe(NOW - (STALE_OPEN_DAYS + 1) * DAY);
  });

  it("an August incident never closed ends at its last update, not today", () => {
    const r = toIncidentRow(row({ startedAt: "2026-08-27T20:00:00Z", sourceUpdatedAt: "2026-08-27T21:00:00Z", lastUpdateAt: "2026-08-27T22:30:00Z" }), NOW);
    expect(r).toMatchObject({ stale: true, resolvedAt: Date.parse("2026-08-27T22:30:00Z") });
  });

  it("a live incident with recent updates stays open", () => {
    const r = toIncidentRow(row({ startedAt: "2026-08-27T20:00:00Z", lastUpdateAt: "2026-10-20T10:00:00Z" }), NOW);
    expect(r).toMatchObject({ stale: false, resolvedAt: null });
  });

  it("resolved incidents are untouched", () => {
    const r = toIncidentRow(row({ startedAt: "2026-08-27T20:00:00Z", resolvedAt: "2026-08-27T21:00:00Z" }), NOW);
    expect(r).toMatchObject({ stale: false, resolvedAt: Date.parse("2026-08-27T21:00:00Z") });
  });
});
