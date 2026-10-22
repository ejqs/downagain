import { describe, expect, it } from "vitest";
import { GRADES } from "@/lib/grading";
import { GRADE_COLORS, SITE_TITLE, pageMeta } from "@/lib/site";

describe("pageMeta", () => {
  it("sets canonical, og and twitter tags from one title", () => {
    const m = pageMeta({ title: "Incidents", description: "All of them.", path: "/incidents" });
    expect(m.title).toBe("Incidents");
    expect(m.alternates?.canonical).toBe("/incidents");
    expect(m.openGraph).toMatchObject({ url: "/incidents", title: "Incidents · downagain.dev", description: "All of them." });
    expect(m.twitter).toMatchObject({ card: "summary_large_image", title: "Incidents · downagain.dev" });
  });

  it("leaves the title to the root default on the home page", () => {
    const m = pageMeta({ path: "/" });
    expect(m.title).toBeUndefined();
    expect(m.openGraph?.title).toBe(SITE_TITLE);
  });
});

it("has share-card colours for every grade", () => {
  for (const g of GRADES) expect(GRADE_COLORS[g.grade]).toHaveLength(2);
});
