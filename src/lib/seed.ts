import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { categories, componentSurfaces, providers } from "@/db/schema";
import { CATEGORIES, PROVIDERS } from "@/lib/providers";

/** Idempotent: inserts or updates categories, providers and surface overrides. */
export async function seed(database: DB) {
  for (const c of CATEGORIES) {
    await database
      .insert(categories)
      .values(c)
      .onConflictDoUpdate({ target: categories.slug, set: { name: c.name, sortOrder: c.sortOrder } });
  }
  const cats = new Map((await database.select().from(categories)).map((c) => [c.slug, c.id]));

  for (const [i, p] of PROVIDERS.entries()) {
    const values = {
      slug: p.slug,
      name: p.name,
      categoryId: cats.get(p.category)!,
      kind: p.kind,
      sortOrder: p.sortOrder ?? i,
      homepageUrl: p.homepageUrl,
      statusPageUrl: p.statusPageUrl,
      sourceKind: p.sourceKind,
      sourceUrl: p.sourceUrl,
    };
    const [row] = await database
      .insert(providers)
      .values(values)
      .onConflictDoUpdate({ target: providers.slug, set: values })
      .returning({ id: providers.id });
    for (const [componentName, surface] of Object.entries(p.surfaces ?? {})) {
      await database
        .insert(componentSurfaces)
        .values({ providerId: row.id, componentName, surface })
        .onConflictDoUpdate({ target: [componentSurfaces.providerId, componentSurfaces.componentName], set: { surface } });
    }
  }
  return { categories: CATEGORIES.length, providers: PROVIDERS.length };
}

export async function providerId(database: DB, slug: string) {
  const [row] = await database.select({ id: providers.id }).from(providers).where(eq(providers.slug, slug));
  return row?.id;
}
