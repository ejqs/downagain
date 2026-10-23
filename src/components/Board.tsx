import Link from "next/link";
import type { Snapshot } from "@/lib/data";
import { dailyLoad, gradeCauses, incidentsFor, leaderboard, downNow, isGraded, liveCount, liveLevel, LIVE_LABEL, scoreFor, valueBoard } from "@/lib/views";
import { fmtDate, fmtDuration, fmtPct, plural } from "@/lib/format";
import { durationMinutes, WINDOW_DAYS } from "@/lib/grading";
import { gradeInput, tierOf, type DayCell } from "@/lib/views";
import { AREA_SHORT, AREAS } from "@/lib/severity";
import { priceText } from "./Value";
import { isPriced } from "@/lib/pricing";
import { DayStrip, GradeTile, SevPill, StripLegend } from "./ui";
import type { Grade } from "@/lib/grading";
import { JsonLd } from "./JsonLd";
import { absUrl } from "@/lib/site";
import { EMPTY_FILTER, filterQuery, isFiltering, withQuery, type NeedFilter } from "@/lib/needs";
import { NeedBar } from "./NeedBar";


export function CategoryTabs({ snap, active, query = "" }: { snap: Snapshot; active: string; query?: string }) {
  const down = downNow(snap);
  return (
    <nav aria-label="Categories" className="tabs">
      {snap.categories.map((c) => {
        const catDown = down.filter((d) => d.provider.category === c.slug);
        const n = catDown.length;
        return (
          <Link
            key={c.slug}
            href={withQuery(c.slug === snap.categories[0]?.slug ? "/" : `/c/${c.slug}`, query)}
            aria-current={c.slug === active ? "true" : undefined}
            data-umami-event="category-filter"
            data-umami-event-category={c.slug}
          >
            {c.name}
            {n ? <span className={`count ${catDown.some((d) => liveLevel(d) === "down") ? "" : "issues"}`} aria-label={liveCount(catDown) ?? undefined}>{n}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function Board({
  snap,
  category,
  sort,
  basePath,
  heading: Heading = "h2",
  filter = EMPTY_FILTER,
  raw,
}: {
  snap: Snapshot;
  category: string;
  sort: "worst" | "best";
  basePath: string;
  heading?: "h1" | "h2";
  filter?: NeedFilter;
  /** The unfiltered snapshot, to count what the filter left out. */
  raw?: Snapshot;
}) {
  const q = filterQuery(filter);
  const picked = [filter.needs.map((n) => n.label).join(", "), filter.region?.label].filter(Boolean).join(" · ");
  const cat = snap.categories.find((c) => c.slug === category);
  const rows = leaderboard(snap, category, sort);
  const value = new Map(valueBoard(snap, category).map((v) => [v.provider.slug, v]));
  return (
    <section className="stack" style={{ ["--gap" as string]: "14px" }}>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: `${cat?.name ?? category}, last 90 days`,
          itemListOrder: sort === "best" ? "https://schema.org/ItemListOrderAscending" : "https://schema.org/ItemListOrderDescending",
          numberOfItems: rows.length,
          itemListElement: rows.map((r, i) => ({ "@type": "ListItem", position: i + 1, name: r.provider.name, url: absUrl(`/p/${r.provider.slug}`) })),
        }}
      />
      <CategoryTabs snap={snap} active={category} query={q} />
      <NeedBar category={category} filter={filter} path={basePath} keep={sort === "best" ? "sort=best" : ""} />
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", ["--gap" as string]: "12px 16px" }}>
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          <Heading className="h2">{cat?.name ?? category}</Heading>
          <p className="body" style={{ marginTop: 6 }}>Last 90 days{isFiltering(filter) ? ` · ${picked}` : ""}</p>
        </div>
        <div className="seg" role="group" aria-label="Sort order">
          <Link href={withQuery(basePath, q)} aria-current={sort === "worst" ? "true" : undefined}>Worst first</Link>
          <Link href={withQuery(basePath, "sort=best", q)} aria-current={sort === "best" ? "true" : undefined}>Best first</Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">Nothing here yet.</div>
      ) : (
        <div className="box">
          {rows.map((r, i) => (
            <div key={r.provider.slug} className={`list-row ${r.live ?? ""}`}>
              <div className="board-name has-why">
                <span className="rank">{r.graded ? i + 1 : "–"}</span>
                <GradeWhy snap={snap} raw={raw} providerId={r.provider.id} grade={r.graded ? r.score.grade : null} picked={isFiltering(filter) ? picked : null} />
                <div className="stack" style={{ ["--gap" as string]: "2px", minWidth: 0 }}>
                  <div className="row" style={{ ["--gap" as string]: "8px" }}>
                    <Link href={`/p/${r.provider.slug}`}>{r.provider.name}</Link>
                    {r.live ? <span className={`pill ${r.live}`}>{LIVE_LABEL[r.live]}</span> : null}
                    {r.graded && r.covered < 90 ? <span className="pill unknown" title={`Graded on ${r.covered} of 90 days`}>{r.covered} DAYS</span> : null}
                    {value.get(r.provider.slug)?.bestValue ? <a href="#value" className="pill value" style={{ textDecoration: "none" }}>BEST VALUE</a> : null}
                  </div>
                  <span className="muted" style={{ fontSize: 14 }}>{r.provider.kind}</span>
                </div>
              </div>
              <div className="board-metrics">
                <div className="areas" aria-label="Area grades">
                  {(snap.focus?.areas ?? AREAS).map((a) => (
                    <span key={a}>
                      <GradeTile grade={r.graded ? r.score.areas[a].grade : null} size="xs" label={`${a} grade ${r.score.areas[a].grade}`} />
                      {AREA_SHORT[a]}
                    </span>
                  ))}
                </div>
                <div className="metric"><b>{r.graded ? fmtPct(r.score.admittedUptime) : "–"}</b><span>ADMITTED UPTIME</span></div>
                <div className="metric"><b>{r.score.incidentCount}</b><span>INCIDENTS</span></div>
                <div className="metric"><b>{r.score.longestMinutes ? fmtDuration(r.score.longestMinutes) : "–"}</b><span>LONGEST</span></div>
                {isPriced(category) ? <PriceMetric v={value.get(r.provider.slug)} /> : null}
              </div>
              <DayStrip cells={r.cells} label={`${r.provider.name}, last 60 days`} tips={dayTips(incidentsFor(snap, r.provider.id), r.cells, snap.generatedAt)} />
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

const short = (ms: number) => fmtDate(ms).replace(/, \d{4}$/, "");

/** One line per day for the strip: "Sep 11 · Sev 2 · Redis latency, 3h 10m +1". */
export function dayTips(list: Parameters<typeof dailyLoad>[0], cells: DayCell[], now: number): (string | null)[] {
  return dailyLoad(list, cells.length, now).map((d, k) => {
    if (cells[k] === "none") return null;
    if (!d.top) return `${short(d.day)} · clean`;
    const dur = fmtDuration(durationMinutes(gradeInput(d.top), new Date(now)));
    return `${short(d.day)} · Sev ${d.worst} · ${d.top.title}, ${d.top.resolvedAt ? dur : "ongoing"}${d.incidents > 1 ? ` +${d.incidents - 1}` : ""}`;
  });
}

/** The grade tile; hover or tap it for the incidents that cost the most. */
function GradeWhy({ snap, raw, providerId, grade, picked }: { snap: Snapshot; raw?: Snapshot; providerId: number; grade: Grade | null; picked: string | null }) {
  const { top, rest } = gradeCauses(snap, providerId);
  const from = snap.generatedAt - WINDOW_DAYS * 86_400_000;
  const counted = (x: Snapshot) => incidentsFor(x, providerId).filter((i) => tierOf(i) > 0 && (i.resolvedAt ?? x.generatedAt) > from).length;
  const left = raw && picked ? counted(raw) - counted(snap) : 0;
  return (
    <>
      <span className="why" tabIndex={0} aria-label={grade ? `Grade ${grade}: what caused it` : "No grade yet"}>
        <GradeTile grade={grade} />
      </span>
      <span className="why-body" role="tooltip">
        {top.length ? (
          top.map((c) => (
            <span key={c.incident.id} className="why-row">
              <SevPill tier={tierOf(c.incident)} security={c.incident.security} />
              <span className="mono" style={{ fontSize: 12 }}>
                {short(c.incident.startedAt)} · {c.incident.resolvedAt ? fmtDuration(durationMinutes(gradeInput(c.incident))) : "ongoing"} · {Math.round(c.share * 100)}%
              </span>
              <span className="t">{c.incident.title}</span>
            </span>
          ))
        ) : (
          <span>Nothing counted, 90 days.</span>
        )}
        {rest ? <span className="mono" style={{ fontSize: 12 }}>+{rest} smaller</span> : null}
        {left > 0 ? <span className="mono" style={{ fontSize: 12, color: "var(--hazard)" }}>{plural(left, "incident")} left out · {picked}</span> : null}
      </span>
    </>
  );
}

function PriceMetric({ v }: { v: ReturnType<typeof valueBoard>[number] | undefined }) {
  return (
    <div className="metric">
      <b>{priceText(v)}</b>
      <span>COST/MO</span>
    </div>
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
            .filter((p) => isGraded(p, snap.generatedAt))
            .map((p) => ({ p, s: scoreFor(snap, p.id) }))
            .sort((a, b) => a.s.points - b.s.points)
            .slice(0, 3);
          const catDown = down.filter((d) => d.provider.category === c.slug);
          const n = liveCount(catDown);
          const worst = catDown.some((d) => liveLevel(d) === "down") ? "down" : "issues";
          return (
            <Link key={c.slug} href={`/c/${c.slug}`} className="box pad stack" style={{ textDecoration: "none", ["--gap" as string]: "10px" }}>
              <span className="row" style={{ justifyContent: "space-between" }}>
                <strong style={{ fontSize: 20 }}>{c.name}</strong>
                <span className={`pill ${n ? worst : "ok"}`}>{n ? n.toUpperCase() : "ALL UP"}</span>
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
          <span className="body" style={{ fontSize: 15 }}>CDN &amp; DNS.</span>
          <a href="https://github.com/ejqs/downagain/issues/new?title=Track%20a%20provider" style={{ fontSize: 14, fontWeight: 700 }}>Suggest a provider</a>
        </div>
      </div>
    </section>
  );
}
