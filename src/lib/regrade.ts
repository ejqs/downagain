import { eq, isNull, lt, or } from "drizzle-orm";
import type { DB } from "@/db";
import { categories, componentSurfaces, incidentUpdates, incidents, providers } from "@/db/schema";
import { finalGrade, gradeColumns, storedVerdict } from "@/lib/review";
import { CLASSIFIER_VERSION, classify, type Surface } from "@/lib/severity";

/**
 * Re-run the classifier over every stored incident and re-apply Claude's stored
 * verdict where the incident hasn't changed since it was reviewed. No API calls.
 * Manual overrides are untouched. With `staleOnly`, only incidents graded by an
 * older CLASSIFIER_VERSION, at most `limit` of them; the poll route runs this so
 * a rules change reaches production without a manual step.
 */
export async function regradeAll(database: DB, opts: { staleOnly?: boolean; limit?: number } = {}) {
  const q = database
    .select({ i: incidents, cat: categories.slug })
    .from(incidents)
    .innerJoin(providers, eq(providers.id, incidents.providerId))
    .innerJoin(categories, eq(categories.id, providers.categoryId))
    .where(opts.staleOnly ? or(isNull(incidents.classifierVersion), lt(incidents.classifierVersion, CLASSIFIER_VERSION)) : undefined)
    .$dynamic();
  const rows = await (opts.limit ? q.limit(opts.limit) : q);
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
    const current = i.reviewedAt && i.reviewedAt >= i.updatedAt;
    const grade = finalGrade(c, current ? await storedVerdict(database, i.id, i.reviewedHash) : null);
    await database.update(incidents).set(gradeColumns(grade)).where(eq(incidents.id, i.id));
    n++;
  }
  return n;
}
