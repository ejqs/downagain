import { describe, expect, it } from "vitest";
import { areaIn, incidentAreas, incidentPlaces, isPlaceKey, outageMap, placeBoard, placeName, placesIn } from "@/lib/places";
import type { IncidentRow } from "@/lib/data";

const keys = (name: string) => placesIn(name).map((p) => p.key);

describe("placesIn", () => {
  it("reads cloud region codes and Azure names", () => {
    expect(keys("us-east-1")).toEqual(["IAD"]);
    expect(keys("asia-southeast1")).toEqual(["SIN"]);
    expect(keys("East US 2")).toEqual(["IAD"]);
    expect(keys("Australia Southeast")).toEqual(["MEL"]);
  });

  it("reads CDN cities, region codes and cities in brackets", () => {
    expect(placesIn("Accra, Ghana - (ACC)")[0]).toMatchObject({ key: "ACC", name: "Accra" });
    expect(placesIn("North America - Ashburn - (IAD)")[0]).toMatchObject({ key: "IAD", name: "Virginia", label: "Ashburn" });
    expect(placesIn("iad1 - Washington, D.C., USA")[0]).toMatchObject({ key: "IAD", name: "Virginia", label: "Washington" });
    expect(keys("SGP1")).toEqual(["SIN"]);
    expect(keys("Elevated errors in iad1 and in sfo1")).toEqual(["IAD", "SFO"]);
    expect(keys("Asia Southeast (Singapore)")).toEqual(["SIN"]);
    expect(keys("Degraded performance in Frankfurt and Paris")).toEqual(["FRA", "CDG"]);
  });

  it("pins countries a carrier incident names", () => {
    expect(keys("SMS Delivery Delays from Twilio to Claro Costa Rica")).toEqual(["costa-rica"]);
    expect(keys("SMS Delivery Delays and Failures from Twilio Short Codes to Multiple Networks in India")).toEqual(["india"]);
    expect(keys("Silent Network Authentication (SNA) Missing Redirects on Vodafone in United Kingdom")).toEqual(["united-kingdom"]);
    expect(keys("MMS Delivery Delays from Twilio to C-Spire United States")).toEqual(["united-states"]);
    expect(keys("SMS to Papua New Guinea and Guinea-Bissau")).toEqual(["papua-new-guinea", "guinea-bissau"]);
    expect(keys("Voice issues in the UK and Türkiye")).toEqual(["united-kingdom", "turkey"]);
    expect(placesIn("Delays to Telcel Mexico")[0]).toMatchObject({ name: "Mexico" });
    // A city wins over its country; states and look-alikes are not countries.
    expect(keys("London, United Kingdom")).toEqual(["LHR"]);
    for (const n of ["Outage in New Mexico", "New Jersey (EWR) errors", "contact us", "Plugins", "Indiana"]) expect(keys(n).filter((k) => /[a-z]/.test(k))).toEqual([]);
    expect(isPlaceKey("costa-rica")).toBe(true);
    expect(isPlaceKey("not-a-country")).toBe(false);
    expect(placeName("united-states")).toBe("United States");
  });

  it("does not read a product acronym in brackets as an airport", () => {
    expect(keys("Digital Asset Management (DAM)")).toEqual([]);
  });

  it("names the broad area of an unplaced incident", () => {
    expect(areaIn("CARRIER NETWORK - SMS, APAC")).toBe("Asia Pacific");
    expect(areaIn("CARRIER NETWORK - SMS, Middle East & Africa")).toBe("Middle East & Africa");
    expect(areaIn("CARRIER NETWORK - SMS, Latin America")).toBe("Latin America");
    expect(areaIn("Builds")).toBe(null);
    expect(incidentAreas({ regions: null, components: ["CARRIER NETWORK - SMS, Europe", "CARRIER NETWORK - Voice, Europe"], title: "Delays" })).toEqual(["Europe"]);
  });

  it("leaves broad areas and products off the map", () => {
    for (const n of ["Elevated errors in Europe", "Builds", "API", "GPT4 errors", "North America", "Phoenix LiveView"]) expect(keys(n)).toEqual([]);
  });
});

describe("outageMap", () => {
  const base = { components: [] as string[], title: "Errors" };
  it("prefers named regions, then components and title", () => {
    expect(incidentPlaces({ ...base, regions: ["eu-west-1"], components: ["Tokyo"] }).map((p) => p.key)).toEqual(["DUB"]);
    expect(incidentPlaces({ ...base, components: ["Singapore, Singapore - (SIN)"], title: "Errors in Tokyo" }).map((p) => p.key)).toEqual(["SIN", "NRT"]);
  });

  it("folds incidents into one point per place and counts the unplaced", () => {
    const sin = placesIn("ap-southeast-1");
    const m = outageMap([
      { places: sin, provider: "AWS", now: false },
      { places: placesIn("Singapore"), provider: "Railway", now: true },
      { places: [], provider: "OpenAI", now: false, areas: ["Europe"] },
      { places: placesIn("us-east-1"), provider: "AWS", now: true, incident: false },
    ]);
    expect(m.placed).toBe(2);
    expect(m.unplaced).toBe(1);
    expect(m.areas).toEqual([{ name: "Europe", incidents: 1 }]);
    expect(m.points.map((p) => [p.key, p.incidents, p.now])).toEqual([["SIN", 2, true], ["IAD", 0, true]]);
    expect(m.points[0]).toMatchObject({ name: "Singapore", aka: ["ap-southeast-1"], providers: ["AWS", "Railway"] });
  });
});

describe("placeBoard", () => {
  const now = Date.parse("2026-10-24T12:00:00Z");
  const H = 3_600_000;
  const row = (o: Partial<IncidentRow>): IncidentRow =>
    ({
      id: 1, providerId: 1, title: "Errors", impact: "major", status: "resolved", startedAt: now - 10 * H, monitoringAt: null, resolvedAt: now - 8 * H,
      url: null, components: [], regions: null, postmortem: false, origin: "live", tier: 2, tierOverride: null, areaTiers: null, surfaces: null,
      security: false, reason: null, overrideNote: null, gradedBy: "rules", scope: null, summary: null, stale: false, ...o,
    }) as IncidentRow;

  it("ranks places by Sev 1–2 time, overlaps once, other tiers left out", () => {
    const rows = placeBoard(
      [
        row({ id: 1, regions: ["us-east-1"] }),
        row({ id: 2, providerId: 2, title: "Errors in iad1", startedAt: now - 9 * H, resolvedAt: now - 7 * H }),
        row({ id: 3, regions: ["ap-southeast-1"], startedAt: now - 5 * H, resolvedAt: now - 4 * H }),
        row({ id: 4, regions: ["eu-west-1"], tier: 3 }),
      ],
      now,
      90,
      (id) => (id === 1 ? "AWS" : "Vercel"),
    );
    expect(rows.map((r) => [r.key, r.minutes, r.incidents])).toEqual([["IAD", 180, 2], ["SIN", 60, 1]]);
    expect(rows[0].providers).toEqual(["AWS", "Vercel"]);
  });
});
