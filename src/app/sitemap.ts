import type { MetadataRoute } from "next";
import { safeSnapshot } from "@/lib/data";
import { CATEGORIES, PROVIDERS } from "@/lib/providers";
import { absUrl } from "@/lib/site";
import { comparePath, matchups } from "@/lib/compare";

// Built per request from the cached snapshot: the build has no database.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const snap = await safeSnapshot();
  const now = new Date(snap?.generatedAt ?? Date.now());
  // Last time anything happened to a provider: an incident starting or resolving.
  const touched = new Map<number, number>();
  for (const i of snap?.incidents ?? []) {
    const t = Math.max(i.startedAt, i.resolvedAt ?? 0);
    if (t > (touched.get(i.providerId) ?? 0)) touched.set(i.providerId, t);
  }
  const providers = snap
    ? snap.providers.map((p) => ({ slug: p.slug, category: p.category, at: touched.get(p.id) }))
    : PROVIDERS.map((p) => ({ slug: p.slug, category: p.category, at: undefined }));
  const categories = snap?.categories ?? CATEGORIES;

  return [
    { url: absUrl("/"), lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: absUrl("/incidents"), lastModified: now, changeFrequency: "hourly", priority: 0.8 },
    { url: absUrl("/security"), lastModified: now, changeFrequency: "daily", priority: 0.6 },
    { url: absUrl("/compare"), changeFrequency: "daily", priority: 0.6 },
    { url: absUrl("/stack"), changeFrequency: "daily", priority: 0.5 },
    { url: absUrl("/about"), changeFrequency: "monthly", priority: 0.4 },
    { url: absUrl("/about/changelog"), changeFrequency: "weekly", priority: 0.3 },
    // The first category's board is the home page.
    ...categories.slice(1).map((c) => ({ url: absUrl(`/c/${c.slug}`), lastModified: now, changeFrequency: "hourly" as const, priority: 0.8 })),
    ...providers.map((p) => ({
      url: absUrl(`/p/${p.slug}`),
      ...(p.at ? { lastModified: new Date(p.at) } : {}),
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...matchups(providers).map(([a, b]) => {
      const at = Math.max(a.at ?? 0, b.at ?? 0);
      return {
        url: absUrl(comparePath([a.slug, b.slug])),
        ...(at ? { lastModified: new Date(at) } : {}),
        changeFrequency: "daily" as const,
        priority: 0.6,
      };
    }),
  ];
}
