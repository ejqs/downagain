import { describe, expect, it } from "vitest";
import { compareHref, comparePath, matchups, pairPath, parsePair } from "@/lib/compare";

describe("compare URLs", () => {
  it("gives each matchup one canonical path, whichever way round", () => {
    expect(comparePath(["vercel", "netlify"])).toBe("/compare/netlify-vs-vercel");
    expect(comparePath(["netlify", "vercel"])).toBe("/compare/netlify-vs-vercel");
    expect(comparePath(["vercel", "fly", "render"])).toBe("/compare/fly-vs-render-vs-vercel");
  });

  it("keeps the picked order for the page itself", () => {
    expect(pairPath(["vercel", "netlify", "vercel"])).toBe("/compare/vercel-vs-netlify");
    expect(parsePair("Vercel-vs-netlify")).toEqual(["vercel", "netlify"]);
  });

  it("falls back to the picker with one provider", () => {
    expect(compareHref(["vercel", "vercel"])).toBe("/compare?p=vercel");
    expect(compareHref(["vercel", "render"])).toBe("/compare/vercel-vs-render");
  });

  it("pairs providers only within a category", () => {
    const provs = [
      { slug: "vercel", category: "hosting" },
      { slug: "openai", category: "ai" },
      { slug: "netlify", category: "hosting" },
      { slug: "anthropic", category: "ai" },
      { slug: "render", category: "hosting" },
    ];
    expect(matchups(provs).map(([a, b]) => comparePath([a.slug, b.slug]))).toEqual([
      "/compare/anthropic-vs-openai",
      "/compare/netlify-vs-render",
      "/compare/netlify-vs-vercel",
      "/compare/render-vs-vercel",
    ]);
  });
});
