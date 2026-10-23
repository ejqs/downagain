// "Your stack": the providers a visitor plans to use, each narrowed to the parts
// they use, kept in the URL so a stack is a link: /stack?u=cloudflare:workers,r2&u=openai
// Parts are the provider's own status-page component names; nothing is hand-mapped.
import type { IncidentRow, ProviderRow, Snapshot } from "@/lib/data";

export const MAX_STACK = 10;
const MAX_PARTS = 24;

export interface StackPick {
  slug: string;
  /** Part keys; empty means all of it. */
  parts: string[];
}

export interface Part {
  key: string;
  name: string;
  group?: string;
  /** Incidents naming this part in the snapshot (about 400 days). */
  count: number;
}

export const partKey = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** A component name without its status-page group: "Cloudflare Sites and Services - Workers" is "Workers". */
export function partName(name: string, groups: Iterable<string>): string {
  for (const g of groups) if (name.startsWith(`${g} - `)) return name.slice(g.length + 3);
  return name;
}

const groupsOf = (p: ProviderRow) => new Set(p.components.flatMap((c) => (c.group ? [c.group] : [])));

/** Every part a provider has listed, on its status page now or on an incident we hold, most-hit first. */
export function partsOf(snap: Snapshot, p: ProviderRow): Part[] {
  const groups = groupsOf(p);
  const parts = new Map<string, Part>();
  const add = (name: string, group?: string) => {
    const key = partKey(name);
    if (key && !parts.has(key)) parts.set(key, { key, name, group, count: 0 });
    return parts.get(key);
  };
  for (const c of p.components) add(c.name, c.group);
  for (const i of snap.incidents) {
    if (i.providerId !== p.id) continue;
    const seen = new Set<string>();
    for (const c of i.components) {
      const part = add(partName(c, groups));
      if (part && !seen.has(part.key)) {
        seen.add(part.key);
        part.count++;
      }
    }
  }
  return [...parts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** "u=cloudflare:workers,r2" (one per provider, repeatable) to picks, keeping only known providers. */
export function parseStack(u: string | string[] | undefined, snap: Snapshot): StackPick[] {
  const known = new Set(snap.providers.map((p) => p.slug));
  const out = new Map<string, StackPick>();
  for (const raw of [u ?? []].flat().flatMap((v) => v.split(" "))) {
    const [slug, list = ""] = raw.toLowerCase().split(":");
    if (!known.has(slug) || out.has(slug) || out.size >= MAX_STACK) continue;
    const parts = [...new Set(list.split(",").map(partKey).filter(Boolean))].slice(0, MAX_PARTS);
    out.set(slug, { slug, parts });
  }
  return [...out.values()];
}

/** One pick as its URL value: "cloudflare:workers,r2". */
export const pickParam = (p: StackPick) => `${p.slug}${p.parts.length ? `:${p.parts.join(",")}` : ""}`;

/** The page for a stack. Keys are [a-z0-9-], so ":" and "," stay readable unescaped. */
export function stackHref(picks: StackPick[], extra: Record<string, string> = {}): string {
  const qs = [
    ...picks.map((p) => `u=${pickParam(p)}`),
    ...Object.entries(extra)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%2C/g, ",")}`),
  ];
  return `/stack${qs.length ? `?${qs.join("&")}` : ""}`;
}

/** The same stack with one part switched on or off for one provider. */
export function togglePart(picks: StackPick[], slug: string, key: string | null): StackPick[] {
  return picks.map((p) => {
    if (p.slug !== slug) return p;
    if (key === null) return { ...p, parts: [] };
    return { ...p, parts: p.parts.includes(key) ? p.parts.filter((k) => k !== key) : [...p.parts, key] };
  });
}

const wordIn = (text: string, name: string) => {
  const esc = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`).test(text.toLowerCase());
};

/**
 * Whether an incident hits the parts picked. One that names components counts only
 * if it names a picked one. One that names none (common on incident.io pages) is
 * judged by its title: out if it names only parts not picked, in otherwise, since we
 * don't discount without evidence.
 */
export function hitsParts(i: IncidentRow, provider: ProviderRow, picked: string[], all: Part[]): boolean {
  if (!picked.length) return true;
  const want = new Set(picked);
  if (i.components.length) {
    const groups = groupsOf(provider);
    return i.components.some((c) => want.has(partKey(partName(c, groups))));
  }
  // A title naming a group ("APIs") names every part in it.
  const named = all.filter((p) => (p.name.length >= 2 && wordIn(i.title, p.name)) || (p.group && wordIn(i.title, p.group)));
  return !named.length || named.some((p) => want.has(p.key));
}

export interface StackEntry {
  provider: ProviderRow;
  pick: StackPick;
  parts: Part[];
  /** The picked parts we know of, by name, in pick order. */
  picked: Part[];
  incidents: IncidentRow[];
}

/** Each pick with its own incidents, only those that hit what was picked. */
export function stackEntries(snap: Snapshot, picks: StackPick[]): StackEntry[] {
  return picks.flatMap((pick) => {
    const provider = snap.providers.find((p) => p.slug === pick.slug);
    if (!provider) return [];
    const parts = partsOf(snap, provider);
    const byKey = new Map(parts.map((p) => [p.key, p]));
    const picked = pick.parts.flatMap((k) => byKey.get(k) ?? []);
    const keys = picked.map((p) => p.key);
    const incidents = snap.incidents.filter((i) => i.providerId === provider.id && hitsParts(i, provider, keys, parts));
    return [{ provider, pick: { ...pick, parts: keys }, parts, picked, incidents }];
  });
}
