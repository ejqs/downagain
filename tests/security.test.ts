import { describe, expect, it } from "vitest";
import type { IncidentRow, ProviderRow, Snapshot } from "@/lib/data";
import { securityKind, securityView } from "@/lib/security";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-31T12:00:00Z");

const k = (title: string, summary: string | null = null, compromise = false) => securityKind({ title, summary, compromise });

describe("securityKind", () => {
  it("reads real status-page wording", () => {
    expect(k("Clarification: Recent Oct 24 API key revocations are precautionary", null, true)).toBe("breach");
    expect(k("Elevated API Errors", "A DDoS attack caused token-request 503 errors across all Ably regions.")).toBe("attack");
    expect(k("Click and Open Tracking Degraded (US Regions)", "A denial-of-service attack hit Mailgun's click and open tracking servers.")).toBe("attack");
    expect(k("Emails not being delivered", "Abuse of free-tier email sending exhausted quota.")).toBe("attack");
    expect(k("openai/gpt-oss-120b Performance Issue", "Degraded performance from coordinated malicious traffic.")).toBe("attack");
    expect(k("Platform Wide Rolling Host Reboots", "Fly.io rebooted hosts fleet-wide as a mitigation for a Linux kernel vulnerability (CVE-2026-1234).")).toBe("patch");
    expect(k("Degraded performance for Directory Provisioning")).toBe("other");
  });

  it("a compromise is a breach whatever else it says", () => {
    expect(k("DDoS attack", null, true)).toBe("breach");
  });
});

function prov(id: number, category = "hosting"): ProviderRow {
  return { id, slug: `p${id}`, name: `Provider ${id}`, kind: null, category, sortOrder: id, statusPageUrl: "https://status.example.com", homepageUrl: null, historyFrom: null, status: "operational", since: null, lastCheckedAt: NOW, components: [] };
}

let nextId = 1;
function inc(providerId: number, p: Partial<IncidentRow> & { startedAt: number }): IncidentRow {
  return { id: nextId++, providerId, title: "Something broke", impact: "major", status: "resolved", monitoringAt: null, resolvedAt: p.startedAt + 3_600_000, url: null, components: [], postmortem: false, origin: "live", tier: 2, tierOverride: null, areaTiers: null, surfaces: null, security: true, reason: null, overrideNote: null, gradedBy: "rules", scope: null, summary: null, stale: false, ...p };
}

describe("securityView", () => {
  const snap: Snapshot = {
    generatedAt: NOW,
    categories: [],
    providers: [prov(1), prov(2), prov(3, "ai")],
    incidents: [
      inc(1, { startedAt: NOW - 10 * DAY, title: "DDoS attack" }),
      inc(1, { startedAt: NOW - 5 * DAY, title: "Login errors", security: false }),
      inc(2, { startedAt: NOW - 20 * DAY, title: "Unauthorized access", compromise: true }),
      inc(3, { startedAt: NOW - 2 * DAY, title: "Kernel patch reboots" }),
    ],
  };

  it("keeps only security incidents, newest first, and puts breaches top of the board", () => {
    const v = securityView(snap);
    expect(v.rows.map((r) => r.kind)).toEqual(["patch", "attack", "breach"]);
    expect(v.counts).toEqual({ breach: 1, attack: 1, patch: 1, other: 0 });
    expect(v.board.map((t) => t.provider.id)).toEqual([2, 3, 1]);
    expect(v.lastBreach?.providerId).toBe(2);
  });

  it("a security incident soon after a breach is its follow-up, counted once", () => {
    const v = securityView({
      ...snap,
      incidents: [
        inc(2, { startedAt: NOW - 20 * DAY, title: "Unauthorized access", compromise: true }),
        inc(2, { startedAt: NOW - 17 * DAY, title: "Clarification: not under a new attack" }),
      ],
    });
    expect(v.rows.map((r) => [r.kind, r.followUp])).toEqual([["breach", true], ["breach", false]]);
    expect(v.counts.breach).toBe(1);
    expect(v.counts.attack).toBe(0);
    expect(v.board[0].total).toBe(1);
  });

  it("filters by provider", () => {
    const v = securityView(snap, (p) => p.category === "ai");
    expect(v.rows).toHaveLength(1);
    expect(v.lastBreach).toBeNull();
  });
});
