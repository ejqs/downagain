import type { Metadata } from "next";
import { safeSnapshot } from "@/lib/data";
import { pageMeta } from "@/lib/site";
import { daysSinceSev1, totals } from "@/lib/views";
import { fmtDuration } from "@/lib/format";
import { AlsoTracking, Board } from "@/components/Board";
import { Stat } from "@/components/ui";
import { Unavailable } from "@/components/Unavailable";
import { GLOSSARY } from "@/lib/glossary";
import { ValueBoard } from "@/components/Value";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMeta({ path: "/" });

export default async function Home({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const snap = await safeSnapshot();
  if (!snap) return <Unavailable />;
  const { sort } = await searchParams;
  const first = snap.categories[0]?.slug ?? "hosting";
  const days = daysSinceSev1(snap);
  const t = totals(snap);

  return (
    <main className="wrap">
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">Hosting, cloud, databases, AI &amp; dev tools</div>
          <h1 className="h1">
            Is it down <span className="highlight">again?</span>
          </h1>
          <p className="lede">
            Who went down, for how long, by their own admission.
          </p>
        </div>
        <aside aria-label="Days since a major outage" className="sign">
          <span className="eyebrow" style={{ letterSpacing: "0.1em" }}>Days without a</span>
          <span className="count">{days ?? "–"}</span>
          <span className="eyebrow" style={{ letterSpacing: "0.1em" }}>Sev 1 outage</span>
        </aside>
      </section>

      <section className="stats" style={{ marginBottom: 40 }} aria-label="Last 90 days, all providers">
        <Stat label="Sev 1 downtime, 90d" value={fmtDuration(t.sev1Minutes)} hint={GLOSSARY.sev1Downtime} />
        <Stat label="Incidents, 90d" value={String(t.incidents)} hint={GLOSSARY.incidents} />
        <Stat label="Providers" value={String(t.providers)} />
        <Stat label="It was DNS" value={String(t.dns)} hot hint={GLOSSARY.dns} />
      </section>

      <Board snap={snap} category={first} sort={sort === "best" ? "best" : "worst"} basePath="/" />
      <ValueBoard snap={snap} category={first} />
      <AlsoTracking snap={snap} current={first} />
    </main>
  );
}
