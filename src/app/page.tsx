import type { Metadata } from "next";
import { safeSnapshot } from "@/lib/data";
import { pageMeta } from "@/lib/site";
import { daysSinceSev1, totals } from "@/lib/views";
import { AlsoTracking, Board } from "@/components/Board";
import { Stat } from "@/components/ui";
import { Unavailable } from "@/components/Unavailable";
import { GLOSSARY } from "@/lib/glossary";
import { ValueBoard } from "@/components/Value";
import { applyFilter, parseFilter } from "@/lib/needs";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMeta({ path: "/" });

export default async function Home({ searchParams }: { searchParams: Promise<{ sort?: string; need?: string; region?: string }> }) {
  const snap = await safeSnapshot();
  if (!snap) return <Unavailable />;
  const q = await searchParams;
  const first = snap.categories[0]?.slug ?? "hosting";
  const filter = parseFilter(q, first);
  const view = applyFilter(snap, filter);
  const days = daysSinceSev1(snap);
  const t = totals(snap);

  return (
    <main className="wrap">
      <section className="hero">
        <h1 className="h1">
          Is it down <span className="highlight">again?</span>
        </h1>
        <p className="lede">
          Who went down, for how long, by their own admission.
        </p>
      </section>

      <section className="statline" style={{ marginBottom: 28 }} aria-label="Last 90 days, all providers">
        <Stat label="Days without a Sev 1" value={days === null ? "–" : String(days)} hot hint={GLOSSARY.daysSince} />
        <Stat label="Incidents, 90d" value={String(t.incidents)} hint={GLOSSARY.incidents} />
        <Stat label="Sev 1, 90d" value={String(t.sev1)} hint={GLOSSARY.sev1Count} />
        <Stat label="It was DNS" value={String(t.dns)} hint={GLOSSARY.dns} />
      </section>

      <Board snap={view} category={first} sort={q.sort === "best" ? "best" : "worst"} basePath="/" filter={filter} />
      <ValueBoard snap={view} category={first} />
      <AlsoTracking snap={snap} current={first} />
    </main>
  );
}
