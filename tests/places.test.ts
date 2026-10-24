import { describe, expect, it } from "vitest";
import { incidentPlaces, outageMap, placesIn } from "@/lib/places";

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
      { places: [], provider: "OpenAI", now: false },
      { places: placesIn("us-east-1"), provider: "AWS", now: true, incident: false },
    ]);
    expect(m.placed).toBe(2);
    expect(m.unplaced).toBe(1);
    expect(m.points.map((p) => [p.key, p.incidents, p.now])).toEqual([["SIN", 2, true], ["IAD", 0, true]]);
    expect(m.points[0]).toMatchObject({ name: "Singapore", aka: ["ap-southeast-1"], providers: ["AWS", "Railway"] });
  });
});
