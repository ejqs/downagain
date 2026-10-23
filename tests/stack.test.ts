import { describe, expect, it } from "vitest";
import type { IncidentRow, ProviderRow, Snapshot } from "@/lib/data";
import { hitsParts, parseStack, partName, partsOf, stackEntries, stackHref, togglePart } from "@/lib/stack";

const NOW = Date.parse("2026-10-22T12:00:00Z");

function prov(id: number, slug: string, components: ProviderRow["components"] = []): ProviderRow {
  return {
    id,
    slug,
    name: slug,
    kind: null,
    category: "hosting",
    sortOrder: id,
    statusPageUrl: "https://status.example.com",
    homepageUrl: null,
    historyFrom: null,
    status: "operational",
    since: null,
    lastCheckedAt: NOW,
    components,
  };
}

let nextId = 1;
function inc(providerId: number, title: string, components: string[] = []): IncidentRow {
  return {
    id: nextId++,
    providerId,
    title,
    impact: "major",
    status: "resolved",
    startedAt: NOW - 86_400_000,
    monitoringAt: null,
    resolvedAt: NOW - 82_800_000,
    url: null,
    components,
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
  };
}

const SVC = "Cloudflare Sites and Services";
const cf = prov(1, "cloudflare", [
  { name: "Workers", status: "operational", group: SVC },
  { name: "R2", status: "operational", group: SVC },
  { name: "Audit Logs", status: "operational", group: SVC },
]);
const oa = prov(2, "openai", [
  { name: "Responses", status: "operational", group: "APIs" },
  { name: "ChatGPT", status: "operational" },
  { name: "Sora", status: "operational" },
]);
const snap = (incidents: IncidentRow[]): Snapshot => ({ generatedAt: NOW, categories: [], providers: [cf, oa], incidents });

describe("stack URLs", () => {
  it("parses picks, drops unknown providers and duplicates", () => {
    const s = snap([]);
    expect(parseStack(["cloudflare:workers,R2,workers", "nope", "openai", "cloudflare"], s)).toEqual([
      { slug: "cloudflare", parts: ["workers", "r2"] },
      { slug: "openai", parts: [] },
    ]);
    expect(parseStack(undefined, s)).toEqual([]);
  });

  it("round-trips through the href", () => {
    const picks = [{ slug: "cloudflare", parts: ["workers", "r2"] }, { slug: "openai", parts: [] }];
    expect(stackHref(picks)).toBe("/stack?u=cloudflare:workers,r2&u=openai");
    expect(stackHref(picks, { day: "2026-10-01" })).toBe("/stack?u=cloudflare:workers,r2&u=openai&day=2026-10-01");
    const q = new URLSearchParams(stackHref(picks).split("?")[1]);
    expect(parseStack(q.getAll("u"), snap([]))).toEqual(picks);
    expect(stackHref([])).toBe("/stack");
  });

  it("toggles one part, or clears to all", () => {
    const picks = [{ slug: "cloudflare", parts: ["workers"] }];
    expect(togglePart(picks, "cloudflare", "r2")[0].parts).toEqual(["workers", "r2"]);
    expect(togglePart(picks, "cloudflare", "workers")[0].parts).toEqual([]);
    expect(togglePart(picks, "cloudflare", null)[0].parts).toEqual([]);
  });
});

describe("parts", () => {
  it("strips the status-page group from incident component names", () => {
    expect(partName(`${SVC} - Workers`, [SVC])).toBe("Workers");
    expect(partName("Ashburn, VA, United States - (IAD)", [SVC])).toBe("Ashburn, VA, United States - (IAD)");
  });

  it("lists status components and incident components, most hit first", () => {
    const parts = partsOf(snap([inc(1, "a", [`${SVC} - R2`]), inc(1, "b", ["R2", `${SVC} - R2`]), inc(1, "c", ["Lisbon - (LIS)"])]), cf);
    expect(parts[0]).toMatchObject({ key: "r2", name: "R2", count: 2 });
    expect(parts.map((p) => p.key)).toContain("lisbon-lis");
    expect(parts.find((p) => p.key === "workers")?.count).toBe(0);
  });
});

describe("hitsParts", () => {
  const s = snap([]);
  const cfParts = partsOf(s, cf);
  const oaParts = partsOf(s, oa);

  it("counts everything when nothing is picked", () => {
    expect(hitsParts(inc(1, "x", [`${SVC} - Audit Logs`]), cf, [], cfParts)).toBe(true);
  });

  it("goes by the components an incident names", () => {
    expect(hitsParts(inc(1, "Workers errors", [`${SVC} - Workers`]), cf, ["workers", "r2"], cfParts)).toBe(true);
    expect(hitsParts(inc(1, "Audit log delays", [`${SVC} - Audit Logs`]), cf, ["workers", "r2"], cfParts)).toBe(false);
  });

  it("falls back to the title when no components are named", () => {
    expect(hitsParts(inc(2, "Elevated errors in Sora"), oa, ["responses"], oaParts)).toBe(false);
    expect(hitsParts(inc(2, "Responses API latency"), oa, ["responses"], oaParts)).toBe(true);
    // A group name in the title names every part in it.
    expect(hitsParts(inc(2, "Elevated errors on APIs"), oa, ["responses"], oaParts)).toBe(true);
    // Names nothing we know: counted, no discount without evidence.
    expect(hitsParts(inc(2, "Elevated error rates"), oa, ["responses"], oaParts)).toBe(true);
  });

  it("matches whole words only", () => {
    const parts = [{ key: "r2", name: "R2", count: 0 }];
    expect(hitsParts(inc(1, "Issues with R2 uploads"), cf, ["workers"], parts)).toBe(false);
    expect(hitsParts(inc(1, "Issues with R22"), cf, ["workers"], parts)).toBe(true);
  });
});

describe("stackEntries", () => {
  it("keeps only the incidents that hit each pick, and ignores unknown part keys", () => {
    const s = snap([inc(1, "w", [`${SVC} - Workers`]), inc(1, "a", [`${SVC} - Audit Logs`]), inc(2, "Sora down")]);
    const [c, o] = stackEntries(s, [{ slug: "cloudflare", parts: ["workers", "nope"] }, { slug: "openai", parts: [] }]);
    expect(c.incidents.map((i) => i.title)).toEqual(["w"]);
    expect(c.pick.parts).toEqual(["workers"]);
    expect(c.picked.map((p) => p.name)).toEqual(["Workers"]);
    expect(o.incidents).toHaveLength(1);
  });
});
