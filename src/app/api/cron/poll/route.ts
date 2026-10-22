import { createHash, timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { db } from "@/db";
import { pollAll } from "@/lib/poller";
import { regradeAll } from "@/lib/regrade";
import { reviewPending, type ReviewReport } from "@/lib/review";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time check of the bearer token. Hashing first makes the lengths equal. */
function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = req.headers.get("authorization") ?? "";
  return timingSafeEqual(digest(got), digest(`Bearer ${secret}`));
}

/** Called every 5 minutes by the Railway cron service. Revalidates cached pages only on change. */
export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const slugs = url.searchParams.get("provider")?.split(",").filter(Boolean);

  let results;
  try {
    results = await pollAll(db(), { slugs });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
  }

  // After a rules change (CLASSIFIER_VERSION bump), regrade stored incidents a batch at a time.
  const regraded = await regradeAll(db(), { staleOnly: true, limit: 500 });

  // Claude refines the grades of new or changed incidents. Never fails the poll:
  // without a key, budget or a working API the rules grade simply stands.
  let review: ReviewReport | { error: string };
  try {
    review = await reviewPending(db(), { slugs, deadlineMs: 45_000 });
  } catch (err) {
    review = { error: err instanceof Error ? err.message : String(err) };
  }

  const changed = [
    ...new Set([
      ...results.filter((r) => r.changed || regraded > 0).map((r) => r.slug),
      ...("changedProviders" in review ? review.changedProviders : []),
    ]),
  ];
  if (changed.length || url.searchParams.has("revalidate")) {
    // Next visitor gets fresh data immediately; outages are exactly when stale pages hurt.
    revalidateTag("status", { expire: 0 });
    for (const slug of changed) revalidateTag(`provider:${slug}`, { expire: 0 });
  }
  return Response.json({
    changed,
    failed: results.filter((r) => !r.ok).map((r) => ({ slug: r.slug, error: r.error })),
    regraded,
    review,
    results: results.map(({ slug, status, newIncidents, updatedIncidents }) => ({ slug, status, newIncidents, updatedIncidents })),
  });
}
