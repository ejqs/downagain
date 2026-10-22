import { safeSnapshot } from "@/lib/data";
import { daysSinceSev1, totals } from "@/lib/views";
import { fmtDuration } from "@/lib/format";
import { AlsoTracking, Board } from "@/components/Board";
import { Stat } from "@/components/ui";
import { Unavailable } from "@/components/Unavailable";

export const dynamic = "force-dynamic";

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
          <div className="eyebrow">Hosting &amp; AI API reliability</div>
          <h1 className="h1">
            Is it down <span className="highlight">again?</span>
          </h1>
          <p className="lede">
            Live status and 90-day track records for the platforms your apps run on, pulled from each provider&apos;s public status page.
          </p>
        </div>
        <aside aria-label="Days since a major outage" className="sign">
          <span className="eyebrow" style={{ letterSpacing: "0.1em" }}>Days since any tracked provider</span>
          <span className="count">{days ?? "–"}</span>
          <span className="eyebrow" style={{ letterSpacing: "0.1em" }}>had a Sev 1 outage</span>
        </aside>
      </section>

      <section className="stats" style={{ marginBottom: 40 }} aria-label="Last 90 days, all providers">
        <Stat label="Admitted Sev 1 downtime (90d)" value={fmtDuration(t.sev1Minutes)} />
        <Stat label="Incidents (90d)" value={String(t.incidents)} />
        <Stat label="Providers tracked" value={String(t.providers)} />
        <Stat label="Mentioned DNS" value={String(t.dns)} hot />
      </section>

      <Board snap={snap} category={first} sort={sort === "best" ? "best" : "worst"} basePath="/" />
      <AlsoTracking snap={snap} current={first} />
    </main>
  );
}
