import { describe, expect, it } from "vitest";
import { CHANGELOG } from "@/lib/changelog";

describe("grading changelog", () => {
  it("runs newest first with real dates", () => {
    for (const c of CHANGELOG) expect(Number.isNaN(Date.parse(`${c.date}T00:00:00Z`))).toBe(false);
    const dates = CHANGELOG.map((c) => c.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("links every entry and keeps titles unique within a day", () => {
    const seen = new Set<string>();
    for (const c of CHANGELOG) {
      expect(c.refs.length).toBeGreaterThan(0);
      expect(c.items.length).toBeGreaterThan(0);
      const key = `${c.date} ${c.title}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("follows the voice guide: no em dashes or exclamation marks", () => {
    for (const c of CHANGELOG) for (const t of [c.title, ...c.items]) expect(t).not.toMatch(/—|!/);
  });
});
