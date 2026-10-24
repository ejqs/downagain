import { describe, expect, it } from "vitest";
import type { IncidentRow } from "@/lib/data";
import { continues, withTimelines } from "@/lib/timelines";

const DAY = 86_400_000;
const H = 3_600_000;
const NOW = Date.parse("2026-10-24T15:00:00Z");
const at = (iso: string) => Date.parse(iso);

let nextId = 100;
function inc(p: Partial<IncidentRow> & { startedAt: number }): IncidentRow {
  return {
    id: nextId++,
    providerId: 1,
    title: "Something broke",
    impact: "major",
    status: "resolved",
    monitoringAt: null,
    resolvedAt: p.startedAt + H,
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

const ids = (list: ReturnType<typeof withTimelines>) =>
  list.map((e) => (e.kind === "timeline" ? e.timeline.members.map((i) => i.id) : e.incident.id));

describe("timelines", () => {
  it("folds Railway's breach, the support site and the key notice into one, at the top", () => {
    const outage = inc({ title: "Railway Platform Outage", tier: 1, security: true, compromise: true, startedAt: at("2026-10-21T07:24:00Z"), resolvedAt: at("2026-10-23T22:10:00Z"), components: ["Builds", "Support & Community"] });
    const earlier = inc({ title: "New builds are temporarily paused", startedAt: at("2026-10-20T17:03:00Z"), components: ["Builds"] });
    const station = inc({ title: "station.railway.com is unavailable", tier: 4, startedAt: at("2026-10-23T22:03:00Z"), resolvedAt: null, components: ["Support & Community"] });
    const keys = inc({ title: "Clarification: Recent Oct 24 API key revocations are precautionary", security: true, startedAt: at("2026-10-24T13:57:00Z"), resolvedAt: null, components: ["Support & Community"] });
    station.follows = outage.id; // Claude's read: the support site went down in the breach
    const list = withTimelines([keys, station, outage, earlier], NOW);
    expect(ids(list)).toEqual([[outage.id, station.id, keys.id], earlier.id]);
    const t = list[0].kind === "timeline" ? list[0].timeline : null;
    expect(t?.lead.id).toBe(outage.id);
    expect(t?.tier).toBe(1);
    expect(t?.security).toBe(true);
    expect(t?.resolvedAt).toBeNull();
  });

  it("follows Claude's link within two weeks, and only to the same provider", () => {
    const a = inc({ startedAt: NOW - 10 * DAY, components: ["API"] });
    const b = inc({ startedAt: NOW - 2 * DAY, follows: a.id, components: ["Dashboard"] });
    expect(continues(a, b, NOW)).toBe(true);
    expect(continues(a, { ...b, providerId: 2 }, NOW)).toBe(false);
    expect(continues({ ...a, startedAt: NOW - 20 * DAY }, b, NOW)).toBe(false);
  });

  it("treats a near-identical title posted while the first was open as the same outage", () => {
    const a = inc({ title: "Elevated Error Rate in ap-southeast-1", startedAt: NOW - 5 * H, resolvedAt: NOW - 2 * H, components: ["Pub/Sub (Singapore)"] });
    const b = (p: Partial<IncidentRow>) => inc({ title: "Elevated Errors in ap-southeast-1", startedAt: NOW - 3 * H, components: ["Pub/Sub (Singapore)"], ...p });
    expect(continues(a, b({}), NOW)).toBe(true);
    // Half an hour of grace after it closes; later is a new incident.
    expect(continues(a, b({ startedAt: NOW - 2 * H + 20 * 60_000 }), NOW)).toBe(true);
    expect(continues(a, b({ startedAt: NOW - H }), NOW)).toBe(false);
    // Another title, another component or another region is another incident.
    expect(continues(a, b({ title: "Elevated errors in eu-west-1" }), NOW)).toBe(false);
    expect(continues(a, b({ components: ["REST API"] }), NOW)).toBe(false);
    expect(continues({ ...a, title: "Region Availability", regions: ["me-central-1"] }, b({ title: "Region Availability", regions: ["me-south-1"] }), NOW)).toBe(false);
    // Busy pages run look-alike incidents side by side: overlap and a shared component aren't enough.
    const sms = inc({ title: "SMS Delivery Delays from Twilio to Orange France", startedAt: NOW - 5 * H, resolvedAt: null, components: ["CARRIER NETWORK - SMS", "Europe"] });
    expect(continues(sms, inc({ title: "SMS Delivery Delays from Twilio to MTN Nigeria", startedAt: NOW - H, components: ["CARRIER NETWORK - SMS"] }), NOW)).toBe(false);
    // Scheduled maintenance doesn't pull in what overlaps it.
    expect(continues({ ...a, tier: 0 }, b({}), NOW)).toBe(false);
  });

  it("joins security incidents only around a real compromise", () => {
    const breach = inc({ security: true, compromise: true, startedAt: NOW - 6 * DAY });
    const notice = inc({ security: true, startedAt: NOW - DAY });
    expect(continues(breach, notice, NOW)).toBe(true);
    expect(continues({ ...breach, compromise: false }, notice, NOW)).toBe(false);
    expect(continues({ ...breach, startedAt: NOW - 9 * DAY }, notice, NOW)).toBe(false);
  });

  it("leaves unrelated incidents alone, newest first", () => {
    const a = inc({ startedAt: NOW - 3 * DAY, components: ["API"] });
    const b = inc({ startedAt: NOW - DAY, components: ["API"] });
    expect(ids(withTimelines([a, b], NOW))).toEqual([b.id, a.id]);
  });
});
