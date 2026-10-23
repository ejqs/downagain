import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { safeSnapshot } from "@/lib/data";
import { AlsoTracking, Board } from "@/components/Board";
import { Unavailable } from "@/components/Unavailable";
import { JsonLd } from "@/components/JsonLd";
import { absUrl, pageMeta } from "@/lib/site";
import { ValueBoard } from "@/components/Value";
import { applyFilter, parseFilter } from "@/lib/needs";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ sort?: string; need?: string; region?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const snap = await safeSnapshot();
  const cat = snap?.categories.find((c) => c.slug === slug);
  if (!cat) return { title: "Category" };
  const names = snap!.providers.filter((p) => p.category === cat.slug).map((p) => p.name);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? cat.name);
  return pageMeta({
    title: `${cat.name} status and uptime, ranked`,
    description: `Is it down? ${list}, ranked by 90-day track record from their own status pages.`,
    // The first category's board is the home page, which the site links to instead.
    path: cat.slug === snap?.categories[0]?.slug ? "/" : `/c/${cat.slug}`,
  });
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const snap = await safeSnapshot();
  if (!snap) return <Unavailable />;
  const { slug } = await params;
  const q = await searchParams;
  const cat = snap.categories.find((c) => c.slug === slug);
  if (!cat) notFound();
  const filter = parseFilter(q, slug);
  const view = applyFilter(snap, filter);
  return (
    <main className="wrap" style={{ paddingTop: 32 }}>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Leaderboard", item: absUrl("/") },
            { "@type": "ListItem", position: 2, name: cat.name, item: absUrl(`/c/${cat.slug}`) },
          ],
        }}
      />
      <Board snap={view} category={slug} sort={q.sort === "best" ? "best" : "worst"} basePath={`/c/${slug}`} heading="h1" filter={filter} raw={snap} />
      <ValueBoard snap={view} category={slug} />
      <AlsoTracking snap={snap} current={slug} />
    </main>
  );
}
