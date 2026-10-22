import type { MetadataRoute } from "next";
import { safeSnapshot } from "@/lib/data";
import { CATEGORIES, PROVIDERS } from "@/lib/providers";
import { absUrl } from "@/lib/site";

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
    ? snap.providers.map((p) => ({ slug: p.slug, at: touched.get(p.id) }))
    : PROVIDERS.map((p) => ({ slug: p.slug, at: undefined }));
  const categories = snap?.categories ?? CATEGORIES;

  return [
    { url: absUrl("/"), lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: absUrl("/incidents"), lastModified: now, changeFrequency: "hourly", priority: 0.8 },
    { url: absUrl("/compare"), changeFrequency: "daily", priority: 0.6 },
    { url: absUrl("/about"), changeFrequency: "monthly", priority: 0.4 },
    // The first category's board is the home page.
    ...categories.slice(1).map((c) => ({ url: absUrl(`/c/${c.slug}`), lastModified: now, changeFrequency: "hourly" as const, priority: 0.8 })),
    ...providers.map((p) => ({
      url: absUrl(`/p/${p.slug}`),
      ...(p.at ? { lastModified: new Date(p.at) } : {}),
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];
}
