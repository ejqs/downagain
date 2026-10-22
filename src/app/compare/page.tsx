import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { safeSnapshot, type Snapshot } from "@/lib/data";
import { Unavailable } from "@/components/Unavailable";
import { Comparison } from "@/components/Comparison";
import { pageMeta } from "@/lib/site";
import { MAX_COMPARE, pairPath } from "@/lib/compare";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ p?: string; a?: string; b?: string; c?: string }> };

export const metadata: Metadata = pageMeta({
  title: "Compare uptime",
  description: "Hosting platforms and AI APIs side by side: grades, admitted uptime, incidents, time to fix and cost.",
  path: "/compare",
});

function askedSlugs(snap: Snapshot, q: Awaited<Props["searchParams"]>): string[] {
  const valid = new Set(snap.providers.map((p) => p.slug));
  const asked = (q.p ? q.p.split(",") : [q.a, q.b, q.c]).filter((s): s is string => Boolean(s && valid.has(s)));
  return [...new Set(asked)].slice(0, MAX_COMPARE);
}

export default async function ComparePage({ searchParams }: Props) {
  const snap = await safeSnapshot();
  if (!snap) return <Unavailable />;
  const asked = askedSlugs(snap, await searchParams);
  // Old ?p=a,b links and the no-JS form land on the matchup's own page.
  if (asked.length >= 2) permanentRedirect(pairPath(asked));
  // Default: the asked provider's (or the first) category, first three providers.
  const category = snap.providers.find((x) => x.slug === asked[0])?.category ?? snap.categories[0]?.slug;
  const fill = snap.providers.filter((p) => p.category === category).map((p) => p.slug);
  const slugs = [...new Set([...asked, ...fill])].slice(0, MAX_COMPARE);
  return (
    <Comparison
      snap={snap}
      slugs={slugs}
      heading={
        <div className="stack" style={{ ["--gap" as string]: "8px" }}>
          <span className="eyebrow">Compare</span>
          <h1 className="h1 sm" style={{ fontSize: "clamp(36px, 7vw, 64px)" }}>Before you migrate.</h1>
        </div>
      }
    />
  );
}
