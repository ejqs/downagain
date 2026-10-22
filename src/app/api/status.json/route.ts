import { safeSnapshot } from "@/lib/data";
import { downNow, scoreFor } from "@/lib/views";

export const dynamic = "force-dynamic";

/** Public, cache-friendly summary for long-open tabs and anyone who wants the data. */
export async function GET() {
  const snap = await safeSnapshot();
  if (!snap) return Response.json({ error: "unavailable" }, { status: 503 });
  const down = downNow(snap);
  return Response.json(
    {
      generatedAt: new Date(snap.generatedAt).toISOString(),
      down: down.map((d) => ({ provider: d.provider.slug, title: d.title, tier: d.tier, since: new Date(d.sinceMs).toISOString() })),
      providers: snap.providers.map((p) => {
        const s = scoreFor(snap, p.id);
        return {
          slug: p.slug,
          name: p.name,
          category: p.category,
          status: p.status,
          grade90d: s.grade,
          areaGrades90d: { production: s.areas.production.grade, shipping: s.areas.shipping.grade, dashboard: s.areas.dashboard.grade },
          admittedUptime90d: Number(s.admittedUptime.toFixed(6)),
          incidents90d: s.incidentCount,
        };
      }),
    },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300", "Access-Control-Allow-Origin": "*" } },
  );
}
