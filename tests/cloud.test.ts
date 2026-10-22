import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readProvider } from "@/lib/adapters";
import { AWS_HISTORY_URL } from "@/lib/adapters/aws";
import { azureRegions, parseRss } from "@/lib/adapters/azure";
import { gcpRegions } from "@/lib/adapters/gcp";
import type { Verdict } from "@/lib/ai-grade";
import { decodeBody, fixtureName, makeGetter } from "@/lib/fetcher";
import { PROVIDERS } from "@/lib/providers";
import { finalGrade } from "@/lib/review";
import { classify, surfaceForComponent } from "@/lib/severity";
import type { Getter, ProviderSource } from "@/lib/types";

const source = (slug: string): ProviderSource => {
  const p = PROVIDERS.find((x) => x.slug === slug)!;
  return { slug, sourceKind: p.sourceKind, sourceUrl: p.sourceUrl, statusPageUrl: p.statusPageUrl };
};

beforeAll(() => {
  process.env.STATUS_FIXTURES_DIR = path.join(__dirname, "fixtures");
});
afterAll(() => {
  delete process.env.STATUS_FIXTURES_DIR;
});

describe("fetcher", () => {
  it("names text fixtures .xml", () => {
    expect(fixtureName("https://azure.status.microsoft/en-us/status/feed/", "text")).toBe("azure.status.microsoft__en-us_status_feed.xml");
  });

  it("decodes UTF-16, gzip and a UTF-8 BOM, as AWS serves all three", () => {
    const json = '[{"summary":"Café"}]';
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(json, "utf16le")]);
    expect(decodeBody(utf16)).toBe(json);
    expect(decodeBody(gzipSync(utf16))).toBe(json);
    expect(decodeBody(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(json)]))).toBe(json);
    expect(decodeBody(Buffer.from(json))).toBe(json);
  });
});

describe("gcp adapter", () => {
  it("reads every incident and keeps one-region trouble from reading as a full outage", async () => {
    const snap = await readProvider(source("gcp"), makeGetter({}));
    expect(snap.incidents).toHaveLength(3);
    const open = snap.incidents!.find((i) => i.externalId === "gcpOpenRegional")!;
    expect(open).toMatchObject({ resolvedAt: null, regions: ["us-central1"], components: ["Google Compute Engine"], impact: "major", worstComponentStatus: "partial_outage" });
    expect(open.url).toBe("https://status.cloud.google.com/incidents/gcpOpenRegional");
    // Only us-central1 is affected, so the cloud as a whole reads degraded, not partial outage.
    expect(snap.status).toBe("degraded");
    expect(snap.components).toEqual([{ name: "Google Compute Engine", group: "us-central1", status: "partial_outage" }]);

    const global = snap.incidents!.find((i) => i.externalId === "gcpGlobalOutage")!;
    expect(global).toMatchObject({ title: "Multiple Google Cloud products are experiencing elevated error rates", impact: "critical", regions: [], postmortem: true });
    expect(global.resolvedAt?.toISOString()).toBe("2026-09-30T19:30:00.000Z");
    expect(global.updates.map((u) => u.status)).toEqual(["outage", "available", "available"]); // oldest first
  });

  it("treats global and multi-region locations as wider than one region", () => {
    expect(gcpRegions([{ id: "us" }])).toEqual([]);
    expect(gcpRegions([{ id: "global" }, { id: "us-east1" }])).toEqual([]);
    expect(gcpRegions([{ id: "europe-west2" }, { id: "europe-west2" }])).toEqual(["europe-west2"]);
  });
});

describe("aws adapter", () => {
  it("merges history across services and keeps the open event from currentevents", async () => {
    const snap = await readProvider(source("aws"), makeGetter({}));
    const ids = snap.incidents!.map((i) => i.externalId);
    expect(ids).toHaveLength(4); // the open event is in both files; the EC2+Lambda event is listed twice
    expect(new Set(ids).size).toBe(4);

    const open = snap.incidents!.find((i) => i.resolvedAt === null)!;
    expect(open).toMatchObject({ regions: ["me-central-1"], worstComponentStatus: "major_outage", impact: "critical", status: "investigating" });
    // Route 53 and the console are listed without a region; the event is still only in me-central-1.
    expect(open.components).toEqual(["Amazon Elastic Compute Cloud", "Amazon Simple Storage Service", "route53", "management-console"]);
    expect(open.startedAt.toISOString()).toBe(new Date(1792652400_000).toISOString());
    expect(snap.status).toBe("degraded");

    const ec2 = snap.incidents!.find((i) => i.externalId.endsWith("USE1_A"))!;
    expect(ec2.components.sort()).toEqual(["AWS Lambda", "Amazon Elastic Compute Cloud"]);
    expect(ec2).toMatchObject({ regions: ["us-east-1"], status: "resolved", worstComponentStatus: "degraded" });
    expect(ec2.resolvedAt?.getTime()).toBe(1790005220_000);
    expect(ec2.updates.at(-1)?.status).toBe("resolved");

    expect(snap.incidents!.find((i) => i.externalId.endsWith("/TWO"))!.regions).toEqual(["us-east-1", "us-west-2"]);
    expect(snap.incidents!.find((i) => i.externalId.endsWith("/GLOBAL"))!.regions).toEqual([]);
  });

  it("still reports open events when the history file hasn't changed", async () => {
    const files = makeGetter({});
    const get: Getter = async (url, opts) => (url === AWS_HISTORY_URL ? { notModified: true } : files(url, opts));
    const snap = await readProvider(source("aws"), get);
    expect(snap.incidents).toHaveLength(1);
    expect(snap.incidents![0].resolvedAt).toBeNull();
  });

  it("all clear is an empty list", async () => {
    const get: Getter = async (url) => (url === AWS_HISTORY_URL ? { notModified: true } : { notModified: false, body: [] });
    const snap = await readProvider(source("aws"), get);
    expect(snap).toMatchObject({ status: "operational", components: [], incidents: [] });
  });
});

describe("azure adapter", () => {
  it("turns feed items into open incidents", async () => {
    const snap = await readProvider(source("azure"), makeGetter({}));
    const [fd, sql] = snap.incidents!;
    expect(fd).toMatchObject({
      externalId: "azure-fd-eus2",
      title: "Azure Front Door - Connectivity issues in East US 2",
      regions: ["East US 2"],
      components: ["Azure Front Door"],
      worstComponentStatus: "partial_outage",
      status: "investigating",
      monitoringAt: null,
    });
    expect(fd.startedAt.toISOString()).toBe("2026-10-22T14:05:00.000Z");
    expect(fd.updates[0].body).toContain("connection failures & timeouts");

    expect(sql).toMatchObject({ regions: [], status: "monitoring", components: ["Azure SQL Database"] });
    expect(sql.monitoringAt?.toISOString()).toBe("2026-10-22T11:15:00.000Z");
    // Front Door is the only unmitigated item, and only in one region.
    expect(snap.status).toBe("degraded");
  });

  it("reads an empty feed as all clear and rejects something that isn't RSS", async () => {
    const empty = '<?xml version="1.0"?><rss version="2.0"><channel><title>Azure Status</title></channel></rss>';
    expect(parseRss(empty)).toEqual([]);
    const snap = await readProvider(source("azure"), async () => ({ notModified: false, body: empty }));
    expect(snap).toMatchObject({ status: "operational", incidents: [] });
    await expect(readProvider(source("azure"), async () => ({ notModified: false, body: "<html>" }))).rejects.toThrow(/unexpected shape/);
  });

  it("finds one named region, and none when the text says it's wider", () => {
    expect(azureRegions("Virtual Machines in East US 2 and East US 2")).toEqual(["East US 2"]);
    expect(azureRegions("Storage in East US")).toEqual(["East US"]);
    expect(azureRegions("West Europe and North Europe")).toEqual(["North Europe", "West Europe"]);
    expect(azureRegions("impact in multiple regions including East US")).toEqual([]);
  });
});

describe("regional scope", () => {
  const base = { title: "Instances unreachable", impact: "critical" as const, components: ["Amazon Elastic Compute Cloud"], worstComponentStatus: "major_outage" as const, categorySlug: "cloud" };

  it("holds a single-region outage at Sev 2", () => {
    const c = classify({ ...base, regions: ["me-central-1"] });
    expect(c.tier).toBe(2);
    expect(c.areaTiers.production).toBe(2);
    expect(c.reason).toBe("Sev 2 because Amazon Elastic Compute Cloud had a major outage, held to Sev 2 as only me-central-1 was hit");
  });

  it("leaves outages across regions, or global ones, at Sev 1", () => {
    expect(classify({ ...base, regions: ["us-east-1", "us-west-2"] }).tier).toBe(1);
    expect(classify({ ...base, regions: [] }).tier).toBe(1);
    expect(classify(base).tier).toBe(1);
  });

  it("never holds data loss", () => {
    expect(classify({ ...base, regions: ["us-east-1"], updateText: "Some customer data was lost." }).tier).toBe(1);
  });

  it("mentions the region without changing a grade that was already Sev 2 or lower", () => {
    const c = classify({ ...base, impact: "minor", worstComponentStatus: "degraded", regions: ["us-east-1"] });
    expect(c.tier).toBe(2);
    expect(c.reason).toMatch(/ in us-east-1$/);
  });

  it("applies to Claude's grade too", () => {
    const rules = classify({ ...base, regions: ["me-central-1"] });
    const v: Verdict = { affected: [{ surface: "serving", tier: 1 }], not_counted: false, scope: "global", security: false, data_loss: false, confidence: "high", rationale: "EC2 was down.", summary: "" };
    expect(finalGrade(rules, v, ["me-central-1"])).toMatchObject({ tier: 2, areaTiers: { production: 2 }, reason: "EC2 was down. Held to Sev 2 as only me-central-1 was hit." });
    expect(finalGrade(rules, v, ["us-east-1", "eu-west-1"]).tier).toBe(1);
    expect(finalGrade(rules, { ...v, data_loss: true }, ["me-central-1"]).tier).toBe(1);
  });
});

describe("cloud surfaces", () => {
  it.each([
    ["Amazon Simple Storage Service", "data"],
    ["Cloud Spanner", "data"],
    ["Google Compute Engine", "serving"],
    ["AWS Lambda", "serving"],
    ["Identity and Access Management", "serving"],
    ["Azure Front Door", "serving"],
    ["Google Cloud Console", "manage"],
    ["Azure Portal", "manage"],
    ["Cloud Build", "ship"],
    ["AWS Support Center", "peripheral"],
  ])("%s is %s", (name, surface) => {
    expect(surfaceForComponent(name, undefined, "cloud")).toBe(surface);
  });
});
