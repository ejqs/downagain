import Link from "next/link";
import type { ProviderRow, Snapshot } from "@/lib/data";
import { communication, incidentsFor, isGraded, monthlyTrend, scoreFor, valueBoard, type ValueRow } from "@/lib/views";
import { WORKLOADS, isPriced } from "@/lib/pricing";
import { priceText } from "@/components/Value";
import { fmtDuration, fmtPct } from "@/lib/format";
import { AREA_LABEL, AREAS } from "@/lib/severity";
import type { Score } from "@/lib/grading";
import { ComparePicker } from "@/components/ComparePicker";
import { Hint } from "@/components/ui";
import { GLOSSARY } from "@/lib/glossary";
import { comparePath, matchups } from "@/lib/compare";

interface Col {
  p: ProviderRow;
  s30: Score;
  s90: Score;
  graded: boolean;
  s1y: Score;
  trend: { count: number }[];
  comms: ReturnType<typeof communication>;
  value: ValueRow | undefined;
}

type Cell = { text: string; value: number | null };

function Row({ label, cells, better, hint }: { label: string; cells: Cell[]; better?: "high" | "low"; hint?: string }) {
  const vals = cells.map((c) => c.value).filter((v): v is number => v != null);
  const best = better && vals.length > 1 ? (better === "high" ? Math.max(...vals) : Math.min(...vals)) : null;
  const allSame = vals.length > 1 && vals.every((v) => v === vals[0]);
  return (
    <div className="cmp-row">
      <span className="label">
        {hint ? <Hint label={label}>{hint}</Hint> : label}
      </span>
      <div className="cmp-cells" style={{ ["--n" as string]: cells.length }}>
        {cells.map((c, k) => (
          <div key={k} className={`cmp-cell ${best != null && !allSame && c.value === best ? "best" : ""}`}>
            {c.text}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The side-by-side table shared by /compare and /compare/[pair]. */
export function Comparison({ snap, slugs, heading }: { snap: Snapshot; slugs: string[]; heading: React.ReactNode }) {
  const now = snap.generatedAt;
  const cols: Col[] = slugs.map((slug) => {
    const p = snap.providers.find((x) => x.slug === slug)!;
    const list = incidentsFor(snap, p.id);
    return {
      p,
      s30: scoreFor(snap, p.id, 30),
      s90: scoreFor(snap, p.id, 90),
      graded: isGraded(p, now),
      s1y: scoreFor(snap, p.id, 365),
      trend: monthlyTrend(list, now),
      comms: communication(list.filter((i) => i.startedAt >= now - 90 * 86_400_000), {}),
      value: valueBoard(snap, p.category).find((v) => v.provider.id === p.id),
    };
  });
  const cell = (f: (c: Col) => number | null, fmt: (v: number) => string): Cell[] =>
    cols.map((c) => {
      const v = f(c);
      return { value: v, text: v == null ? "–" : fmt(v) };
    });
  const areas = AREAS;
  const pct = (v: number) => fmtPct(v);
  const dur = (v: number) => fmtDuration(v);
  const num = (v: number) => String(v);

  const sameCategory = cols.every((c) => c.p.category === cols[0]?.p.category);
  const byPoints = [...cols].sort((a, b) => a.s90.points - b.s90.points);
  const byMttr = [...cols].filter((c) => c.s90.medianResolveMinutes != null).sort((a, b) => a.s90.medianResolveMinutes! - b.s90.medianResolveMinutes!);

  const options = snap.categories.map((c) => ({ cat: c, provs: snap.providers.filter((p) => p.category === c.slug) }));

  return (
    <main className="wrap stack" style={{ paddingTop: 24, ["--gap" as string]: "24px", maxWidth: 1080 }}>
      {heading}

      <ComparePicker key={slugs.join(",")} slugs={slugs} options={options} />

      {cols.length < 2 ? (
        <div className="empty">Pick two.</div>
      ) : (
        <>
          <section className="stack" style={{ ["--gap" as string]: "8px" }}>
            <div className="cmp-cells" style={{ ["--n" as string]: cols.length }}>
              {cols.map((c) => (
                <Link key={c.p.slug} href={`/p/${c.p.slug}`} style={{ fontSize: "clamp(18px, 3.5vw, 26px)", fontWeight: 800, overflowWrap: "anywhere" }}>{c.p.name}</Link>
              ))}
            </div>
          </section>

          <section className="stack" style={{ ["--gap" as string]: "8px" }}>
            <h2 className="h2">Admitted uptime</h2>
            <div className="box">
              <Row hint={GLOSSARY.uptime} label="Last 30 days" cells={cell((c) => c.s30.admittedUptime, pct)} better="high" />
              <Row label="Last 90 days" cells={cell((c) => c.s90.admittedUptime, pct)} better="high" />
              <Row label="Last 12 months" cells={cell((c) => c.s1y.admittedUptime, pct)} better="high" />
            </div>
          </section>

          <section className="stack" style={{ ["--gap" as string]: "8px" }}>
            <h2 className="h2">Grades (90 days)</h2>
            <div className="box">
              <Row hint={GLOSSARY.grade} label="Overall" cells={cols.map((c) => (c.graded ? { text: `${c.s90.grade} · ${c.s90.points.toLocaleString("en-US")} pts`, value: c.s90.points } : { text: "–", value: null }))} better="low" />
              {areas.map((a) => (
                <Row key={a} hint={GLOSSARY[a]} label={AREA_LABEL[a]} cells={cols.map((c) => (c.graded ? { text: c.s90.areas[a].grade, value: Math.round(c.s90.areas[a].points) } : { text: "–", value: null }))} better="low" />
              ))}
            </div>
          </section>

          <section className="stack" style={{ ["--gap" as string]: "8px" }}>
            <h2 className="h2">Incidents (90 days)</h2>
            <div className="box">
              <Row hint={GLOSSARY.incidents} label="Total incidents" cells={cell((c) => c.s90.incidentCount, num)} better="low" />
              <Row hint={GLOSSARY.sev1} label="Sev 1 · Lights out" cells={cell((c) => c.s90.sevCounts[0], num)} better="low" />
              <Row hint={GLOSSARY.sev2} label="Sev 2 · Bleeding" cells={cell((c) => c.s90.sevCounts[1], num)} better="low" />
              <Row hint={GLOSSARY.sev3} label="Sev 3 · Can't ship" cells={cell((c) => c.s90.sevCounts[2], num)} better="low" />
              <Row hint={GLOSSARY.sev4} label="Sev 4 · Papercut" cells={cell((c) => c.s90.sevCounts[3], num)} better="low" />
              <Row hint={GLOSSARY.mttr} label="Median fix" cells={cell((c) => c.s90.medianResolveMinutes, dur)} better="low" />
              <Row hint={GLOSSARY.longest} label="Longest" cells={cell((c) => c.s90.longestMinutes || null, dur)} better="low" />
              <Row hint={GLOSSARY.security} label="Security incidents" cells={cell((c) => c.s90.securityCount, num)} better="low" />
            </div>
          </section>

          <section className="stack" style={{ ["--gap" as string]: "8px" }}>
            <h2 className="h2">Trend and communication</h2>
            <div className="box">
              <Row
                hint={GLOSSARY.trend}
                label="Last 6 months vs 6 before"
                cells={cols.map((c) => {
                  const a = c.trend.slice(0, 6).reduce((n, t) => n + t.count, 0);
                  const b = c.trend.slice(6).reduce((n, t) => n + t.count, 0);
                  return { text: `${b > a ? "Worse" : b < a ? "Better" : "Flat"} (${a} → ${b})`, value: b - a };
                })}
                better="low"
              />
              <Row hint={GLOSSARY.postmortems} label="Sev 1–2 postmortems" cells={cols.map((c) => ({ text: `${c.comms.postmortems} of ${c.comms.serious}`, value: c.comms.serious ? c.comms.postmortems / c.comms.serious : null }))} better="high" />
            </div>
          </section>

          {sameCategory && isPriced(cols[0].p.category) ? (
          <section className="stack" style={{ ["--gap" as string]: "8px" }}>
            <h2 className="h2">Cost</h2>
            <div className="box">
              <Row
                hint={WORKLOADS[cols[0].p.category]?.summary}
                label="Per month"
                cells={cols.map((c) => ({ text: priceText(c.value), value: c.value?.usd ?? null }))}
                better="low"
              />
              <Row label="Plan or model" cells={cols.map((c) => ({ text: c.value?.price?.plan ?? "–", value: null }))} />
              <Row hint={GLOSSARY.bestValue} label="Best value" cells={cols.map((c) => ({ text: c.value?.usd == null ? "–" : c.value.bestValue ? "Yes" : "No", value: null }))} />
            </div>
          </section>
          ) : null}

          <section className="verdict">
            <span className="eyebrow">Verdict</span>
            <span style={{ fontSize: "clamp(22px, 4vw, 30px)", fontWeight: 800, lineHeight: 1.15 }}>
              {byPoints[0].p.name} has the best 90-day record
              {byMttr.length ? `; ${byMttr[0].p.name} resolves incidents fastest.` : "."}
            </span>
            <span style={{ fontSize: 16 }}>Running app? Watch Production. Deploying all day? Watch Shipping.</span>
          </section>
        </>
      )}
      <Matchups snap={snap} current={cols.length === 2 ? comparePath(slugs) : null} />
      <p className="muted" style={{ fontSize: 14 }}>
        Uptime as admitted on each status page. <Link href="/about">How grades work</Link>
      </p>
    </main>
  );
}

/** Every same-category pair, so each matchup page is one link from any other. */
function Matchups({ snap, current }: { snap: Snapshot; current: string | null }) {
  return (
    <section className="stack" style={{ ["--gap" as string]: "12px" }} aria-label="Matchups">
      <h2 className="h2">Matchups</h2>
      {snap.categories.map((c) => {
        const pairs = matchups(snap.providers.filter((p) => p.category === c.slug));
        if (!pairs.length) return null;
        return (
          <div key={c.slug} className="stack" style={{ ["--gap" as string]: "8px" }}>
            <span className="eyebrow">{c.name}</span>
            <div className="chips">
              {pairs.map(([a, b]) => {
                const href = comparePath([a.slug, b.slug]);
                return (
                  <Link key={href} href={href} className="chip small" aria-current={href === current ? "true" : undefined}>
                    {a.name} vs {b.name}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}
