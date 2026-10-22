import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { safeSnapshot } from "@/lib/data";
import { AlsoTracking, Board } from "@/components/Board";
import { Unavailable } from "@/components/Unavailable";
import { JsonLd } from "@/components/JsonLd";
import { absUrl, pageMeta } from "@/lib/site";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ sort?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const snap = await safeSnapshot();
  const cat = snap?.categories.find((c) => c.slug === slug);
  if (!cat) return { title: "Category" };
  return pageMeta({
    title: `${cat.name} leaderboard`,
    description: `${cat.name} providers ranked by their 90-day track record, from their own status pages.`,
    // The first category's board is the home page, which the site links to instead.
    path: cat.slug === snap?.categories[0]?.slug ? "/" : `/c/${cat.slug}`,
  });
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const snap = await safeSnapshot();
  if (!snap) return <Unavailable />;
  const { slug } = await params;
  const { sort } = await searchParams;
  const cat = snap.categories.find((c) => c.slug === slug);
  if (!cat) notFound();
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
      <Board snap={snap} category={slug} sort={sort === "best" ? "best" : "worst"} basePath={`/c/${slug}`} />
      <AlsoTracking snap={snap} current={slug} />
    </main>
  );
}
