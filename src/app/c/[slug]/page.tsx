import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { safeSnapshot } from "@/lib/data";
import { AlsoTracking, Board } from "@/components/Board";
import { Unavailable } from "@/components/Unavailable";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ sort?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const snap = await safeSnapshot();
  const cat = snap?.categories.find((c) => c.slug === slug);
  return { title: cat ? `${cat.name} leaderboard` : "Category" };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const snap = await safeSnapshot();
  if (!snap) return <Unavailable />;
  const { slug } = await params;
  const { sort } = await searchParams;
  if (!snap.categories.some((c) => c.slug === slug)) notFound();
  return (
    <main className="wrap" style={{ paddingTop: 32 }}>
      <Board snap={snap} category={slug} sort={sort === "best" ? "best" : "worst"} basePath={`/c/${slug}`} />
      <AlsoTracking snap={snap} current={slug} />
    </main>
  );
}
