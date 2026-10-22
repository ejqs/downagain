import Link from "next/link";
import type { Snapshot } from "@/lib/data";
import { leaderboard, downNow, scoreFor } from "@/lib/views";
import { fmtDuration, fmtPct } from "@/lib/format";
import { AREA_SHORT, AREAS } from "@/lib/severity";
import { DayStrip, GradeTile, StripLegend } from "./ui";


export function CategoryTabs({ snap, active }: { snap: Snapshot; active: string }) {
  const down = downNow(snap);
  return (
    <nav aria-label="Categories" className="chips" style={{ paddingBottom: 14, borderBottom: "3px solid var(--ink)" }}>
      {snap.categories.map((c) => {
        const n = down.filter((d) => d.provider.category === c.slug).length;
        return (
          <Link
            key={c.slug}
            href={c.slug === snap.categories[0]?.slug ? "/" : `/c/${c.slug}`}
            className="chip"
            aria-current={c.slug === active ? "true" : undefined}
            data-umami-event="category-filter"
            data-umami-event-category={c.slug}
          >
            {c.name}
            {n > 0 ? <span className="count">{n} down</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function Board({ snap, category, sort, basePath }: { snap: Snapshot; category: string; sort: "worst" | "best"; basePath: string }) {
  const cat = snap.categories.find((c) => c.slug === category);
  const rows = leaderboard(snap, category, sort);
  return (
    <section className="stack" style={{ ["--gap" as string]: "14px" }}>
      <CategoryTabs snap={snap} active={category} />
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", ["--gap" as string]: "12px 16px" }}>
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          <h2 className="h2">{cat?.name ?? category}</h2>
          <p className="body" style={{ marginTop: 6 }}>Last 90 days</p>
        </div>
        <div className="seg" role="group" aria-label="Sort order">
          <Link href={basePath} aria-current={sort === "worst" ? "true" : undefined}>Worst first</Link>
          <Link href={`${basePath}?sort=best`} aria-current={sort === "best" ? "true" : undefined}>Best first</Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">Nothing here yet.</div>
      ) : (
        <div className="box">
          {rows.map((r, i) => (
            <div key={r.provider.slug} className={`list-row ${r.down ? "down" : ""}`}>
              <div className="board-name">
                <span className="rank">{i + 1}</span>
                <GradeTile grade={r.score.grade} label={`Overall grade ${r.score.grade}`} />
                <div className="stack" style={{ ["--gap" as string]: "2px", minWidth: 0 }}>
                  <div className="row" style={{ ["--gap" as string]: "8px" }}>
                    <Link href={`/p/${r.provider.slug}`}>{r.provider.name}</Link>
                    {r.down ? <span className="pill down">DOWN NOW</span> : null}
                  </div>
                  <span className="muted" style={{ fontSize: 14 }}>{r.provider.kind}</span>
                </div>
              </div>
              <div className="board-metrics">
                <div className="areas" aria-label="Area grades">
                  {AREAS.map((a) => (
                    <span key={a}>
                      <GradeTile grade={r.score.areas[a].grade} size="xs" label={`${a} grade ${r.score.areas[a].grade}`} />
                      {AREA_SHORT[a]}
                    </span>
                  ))}
                </div>
                <div className="metric"><b>{fmtPct(r.score.admittedUptime)}</b><span>ADMITTED UPTIME</span></div>
                <div className="metric"><b>{r.score.incidentCount}</b><span>INCIDENTS</span></div>
                <div className="metric"><b>{r.score.longestMinutes ? fmtDuration(r.score.longestMinutes) : "–"}</b><span>LONGEST</span></div>
              </div>
              <DayStrip cells={r.cells} label={`${r.provider.name}, last 60 days`} />
            </div>
          ))}
        </div>
      )}
      <StripLegend />
      <p className="mono" style={{ fontSize: 12, color: "var(--body)" }}>
        PROD = your users hit. SHIP = you can&apos;t deploy or manage. <Link href="/about">How grades work</Link>
      </p>
    </section>
  );
}

export function AlsoTracking({ snap, current }: { snap: Snapshot; current: string }) {
  const others = snap.categories.filter((c) => c.slug !== current);
  const down = downNow(snap);
  return (
    <section aria-label="Other categories" className="section stack" style={{ ["--gap" as string]: "14px" }}>
      <h2 className="h2">Also tracking</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        {others.map((c) => {
          const provs = snap.providers.filter((p) => p.category === c.slug);
          const top = provs
            .map((p) => ({ p, s: scoreFor(snap, p.id) }))
            .sort((a, b) => a.s.points - b.s.points)
            .slice(0, 3);
          const n = down.filter((d) => d.provider.category === c.slug).length;
          return (
            <Link key={c.slug} href={`/c/${c.slug}`} className="box pad stack" style={{ textDecoration: "none", ["--gap" as string]: "10px" }}>
              <span className="row" style={{ justifyContent: "space-between" }}>
                <strong style={{ fontSize: 20 }}>{c.name}</strong>
                <span className={`pill ${n ? "down" : "ok"}`}>{n ? `${n} DOWN` : "ALL UP"}</span>
              </span>
              {top.map(({ p, s }) => (
                <span key={p.slug} className="row" style={{ justifyContent: "space-between", fontSize: 15 }}>
                  <span>{p.name}</span>
                  <span className="mono">{s.grade} · {fmtPct(s.admittedUptime)}</span>
                </span>
              ))}
              <span style={{ fontSize: 14, fontWeight: 700, textDecoration: "underline" }}>All {provs.length}</span>
            </Link>
          );
        })}
        <div className="empty stack" style={{ ["--gap" as string]: "8px", padding: 16 }}>
          <strong style={{ fontSize: 20 }}>Next up</strong>
          <span className="body" style={{ fontSize: 15 }}>Databases, CI, CDN &amp; DNS.</span>
          <a href="https://github.com/ejqs/downagain/issues/new?title=Track%20a%20provider" style={{ fontSize: 14, fontWeight: 700 }}>Suggest a provider</a>
        </div>
      </div>
    </section>
  );
}
