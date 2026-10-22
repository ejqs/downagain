// Railway's status API only lists open incidents, so a first poll found almost
// nothing. These were read by hand, once, from status.railway.com/historical
// and each incident page (2026-10-22). Times are to the minute, update text is
// shortened. A few incidents were never marked resolved on Railway's page; those
// end at their last update, which undercounts rather than guesses.
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { categories, providers } from "@/db/schema";
import { normalizeRwIncident, type RwIncident } from "@/lib/adapters/railway";
import { writeIncidents } from "@/lib/poller";
import railway from "@/lib/archive/railway.json";

interface ArchivedIncident {
  slug: string;
  title: string;
  components: { name: string; impact: string }[];
  updates: { status: string; at: string; message: string }[];
}

const RANK = ["DEGRADED_PERFORMANCE", "PARTIAL_OUTAGE", "MAJOR_OUTAGE"];

export function toRwIncident(a: ArchivedIncident): RwIncident {
  const ups = [...a.updates].sort((x, y) => x.at.localeCompare(y.at));
  const last = ups[ups.length - 1];
  const worstImpact = a.components.map((c) => c.impact).sort((x, y) => RANK.indexOf(y) - RANK.indexOf(x))[0] ?? null;
  return {
    id: a.slug,
    slug: a.slug,
    title: a.title,
    status: "RESOLVED",
    createdAt: ups[0].at,
    updatedAt: last.at,
    resolvedAt: (ups.find((u) => u.status === "RESOLVED") ?? last).at,
    worstImpact,
    components: a.components.map((c) => ({ component: { id: c.name, name: c.name }, impact: c.impact })),
    updates: ups.map((u, n) => ({ id: `${a.slug}-${n}`, createdAt: u.at, message: u.message, status: u.status })),
  };
}

/** Idempotent: unchanged incidents are skipped, and nothing live is closed. */
export async function importArchives(database: DB, now = new Date()) {
  const [row] = await database
    .select({ p: providers, categorySlug: categories.slug })
    .from(providers)
    .innerJoin(categories, eq(categories.id, providers.categoryId))
    .where(eq(providers.slug, "railway"));
  if (!row) return { inserted: 0, updated: 0 };
  const list = (railway as ArchivedIncident[]).map((a) => normalizeRwIncident(toRwIncident(a), row.p.statusPageUrl));
  return writeIncidents(database, row.p, row.categorySlug, list, "backfill", now, { closeVanished: false });
}
