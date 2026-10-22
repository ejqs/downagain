import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { safeSnapshot, type Snapshot } from "@/lib/data";
import { scoreFor } from "@/lib/views";
import { fmtPct } from "@/lib/format";
import { Unavailable } from "@/components/Unavailable";
import { Comparison } from "@/components/Comparison";
import { JsonLd } from "@/components/JsonLd";
import { absUrl, pageMeta } from "@/lib/site";
import { MAX_COMPARE, comparePath, parsePair } from "@/lib/compare";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ pair: string }> };

/** The providers named in the URL, or null unless that's 2 or 3 distinct, known ones. */
function pick(snap: Snapshot, pair: string) {
  const slugs = parsePair(pair);
  const found = slugs.map((s) => snap.providers.find((p) => p.slug === s));
  if (slugs.length < 2 || slugs.length > MAX_COMPARE || new Set(slugs).size !== slugs.length || found.some((p) => !p)) return null;
  return found as NonNullable<(typeof found)[number]>[];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { pair } = await params;
  const snap = await safeSnapshot();
  const provs = snap ? pick(snap, pair) : null;
  if (!snap || !provs) return { title: "Compare" };
  const names = provs.map((p) => p.name).join(" vs ");
  const scores = provs.map((p) => scoreFor(snap, p.id));
  const vs = (f: (s: (typeof scores)[number]) => string) => scores.map(f).join(" vs ");
  return pageMeta({
    title: `${names}: uptime and outages`,
    description: `${names}, last 90 days. Grade ${vs((s) => s.grade)}. Incidents ${vs((s) => String(s.incidentCount))}. Admitted uptime ${vs((s) => fmtPct(s.admittedUptime))}.`,
    path: comparePath(provs.map((p) => p.slug)),
  });
}

export default async function PairPage({ params }: Props) {
  const snap = await safeSnapshot();
  if (!snap) return <Unavailable />;
  const { pair } = await params;
  const provs = pick(snap, pair);
  if (!provs) notFound();
  const names = provs.map((p) => p.name).join(" vs ");
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Compare", item: absUrl("/compare") },
            { "@type": "ListItem", position: 2, name: names, item: absUrl(comparePath(provs.map((p) => p.slug))) },
          ],
        }}
      />
      <Comparison
        snap={snap}
        slugs={provs.map((p) => p.slug)}
        heading={
          <div className="stack" style={{ ["--gap" as string]: "8px" }}>
            <span className="eyebrow">Compare</span>
            <h1 className="h1 sm" style={{ fontSize: "clamp(32px, 6vw, 56px)", overflowWrap: "anywhere" }}>{names}</h1>
          </div>
        }
      />
    </>
  );
}
