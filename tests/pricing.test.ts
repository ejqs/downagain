import { describe, expect, it } from "vitest";
import { PRICES, STALE_AFTER_DAYS, checkedMs, isPriced, isStale, monthlyUsd, valueFrontier } from "@/lib/pricing";
import { PROVIDERS } from "@/lib/providers";

describe("price data", () => {
  it("prices every provider in a priced category, and only those", () => {
    for (const p of PROVIDERS) expect(Boolean(PRICES[p.slug]), p.slug).toBe(isPriced(p.category));
    expect(isPriced("hosting")).toBe(true);
    expect(isPriced("ai")).toBe(false);
  });
  it("has a real source and a check date for every entry", () => {
    for (const [slug, p] of Object.entries(PRICES)) {
      expect(p.source, slug).toMatch(/^https:\/\//);
      expect(p.checked, slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(checkedMs(p)), slug).toBe(false);
    }
  });
  it("explains any provider left without a comparable price", () => {
    for (const [slug, p] of Object.entries(PRICES)) if (monthlyUsd(p) == null) expect(p.note, slug).toBeTruthy();
  });
});

describe("monthlyUsd", () => {
  it("adds the lines, credits included", () => {
    expect(monthlyUsd(PRICES.railway)).toBe(12);
    expect(monthlyUsd(PRICES.render)).toBe(21.25);
    expect(monthlyUsd({ ...PRICES.fly, lines: [] })).toBeNull();
    expect(monthlyUsd(undefined)).toBeNull();
  });
});

describe("isStale", () => {
  const p = { ...PRICES.fly, checked: "2026-01-01" };
  it(`flags prices older than ${STALE_AFTER_DAYS} days`, () => {
    expect(isStale(p, Date.parse("2026-03-01T00:00:00Z"))).toBe(false);
    expect(isStale(p, Date.parse("2026-06-01T00:00:00Z"))).toBe(true);
  });
});

describe("valueFrontier", () => {
  const v = valueFrontier([
    { id: "cheap-good", usd: 5, gradeRank: 1 },
    { id: "cheap-bad", usd: 4, gradeRank: 4 },
    { id: "pricey-best", usd: 20, gradeRank: 0 },
    { id: "pricey-good", usd: 20, gradeRank: 1 },
    { id: "mid-worse", usd: 7, gradeRank: 2 },
    { id: "unpriced", usd: null, gradeRank: 0 },
  ]);
  it("keeps everyone nobody beats on both price and grade", () => {
    expect(v["cheap-good"].bestValue).toBe(true);
    expect(v["cheap-bad"].bestValue).toBe(true);
    expect(v["pricey-best"].bestValue).toBe(true);
  });
  it("names who beats the rest", () => {
    expect(v["pricey-good"]).toEqual({ bestValue: false, beatenBy: "pricey-best" });
    expect(v["mid-worse"]).toEqual({ bestValue: false, beatenBy: "cheap-good" });
  });
  it("leaves unpriced providers out", () => {
    expect(v.unpriced).toBeUndefined();
  });
  it("treats identical price and grade as a tie, not a loss", () => {
    const t = valueFrontier([
      { id: "a", usd: 5, gradeRank: 1 },
      { id: "b", usd: 5, gradeRank: 1 },
    ]);
    expect(t.a.bestValue && t.b.bestValue).toBe(true);
  });
});
