import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { categories, componentSurfaces, incidentUpdates, incidents, providers } from "@/db/schema";
import { classify, type Surface } from "@/lib/severity";

/** Re-run the classifier over every stored incident. Manual overrides are untouched. */
export async function regradeAll(database: DB) {
  const rows = await database
    .select({ i: incidents, cat: categories.slug })
    .from(incidents)
    .innerJoin(providers, eq(providers.id, incidents.providerId))
    .innerJoin(categories, eq(categories.id, providers.categoryId));
  const overrides = new Map<number, Map<string, Surface>>();
  for (const r of await database.select().from(componentSurfaces)) {
    if (!overrides.has(r.providerId)) overrides.set(r.providerId, new Map());
    overrides.get(r.providerId)!.set(r.componentName, r.surface as Surface);
  }
  let n = 0;
  for (const { i, cat } of rows) {
    const updates = await database.select({ body: incidentUpdates.body }).from(incidentUpdates).where(eq(incidentUpdates.incidentId, i.id));
    const c = classify(
      {
        title: i.title,
        impact: i.impact,
        components: i.components,
        worstComponentStatus: i.worstComponentStatus,
        updateText: updates.map((u) => u.body).join("\n"),
        categorySlug: cat,
      },
      overrides.get(i.providerId),
    );
    await database
      .update(incidents)
      .set({ tier: c.tier, areaTiers: c.areaTiers, surfaces: c.surfaces, security: c.security, lowConfidence: c.lowConfidence, reason: c.reason, classifierVersion: c.classifierVersion })
      .where(eq(incidents.id, i.id));
    n++;
  }
  return n;
}
