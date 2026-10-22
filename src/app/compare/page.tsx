import type { Metadata } from "next";
import { safeSnapshot, type ProviderRow, type Snapshot } from "@/lib/data";
import { communication, incidentsFor, monthlyTrend, scoreFor } from "@/lib/views";
import { fmtDuration, fmtPct } from "@/lib/format";
import { AREA_LABEL, type Area } from "@/lib/severity";
import type { Score } from "@/lib/grading";
import { Unavailable } from "@/components/Unavailable";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Compare providers" };

type Props = { searchParams: Promise<{ p?: string; a?: string; b?: string; c?: string }> };

interface Col {
  p: ProviderRow;
  s30: Score;
  s90: Score;
  s1y: Score;
  trend: { count: number }[];
  comms: ReturnType<typeof communication>;
}

type Cell = { text: string; value: number | null };

function Row({ label, cells, better }: { label: string; cells: Cell[]; better?: "high" | "low" }) {
  const vals = cells.map((c) => c.value).filter((v): v is number => v != null);
  const best = better && vals.length > 1 ? (better === "high" ? Math.max(...vals) : Math.min(...vals)) : null;
  const allSame = vals.length > 1 && vals.every((v) => v === vals[0]);
  return (
    <div className="cmp-row">
      <span className="label">{label}</span>
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

function pickSlugs(snap: Snapshot, q: Awaited<Props["searchParams"]>): string[] {
  const valid = new Set(snap.providers.map((p) => p.slug));
  const asked = (q.p ? q.p.split(",") : [q.a, q.b, q.c]).filter((s): s is string => Boolean(s && valid.has(s)));
  const unique = [...new Set(asked)].slice(0, 3);
  if (unique.length >= 2) return unique;
  // Default: the first category's first three providers.
  const first = snap.categories[0]?.slug;
  const fill = snap.providers.filter((p) => p.category === (snap.providers.find((x) => x.slug === unique[0])?.category ?? first)).map((p) => p.slug);
  return [...new Set([...unique, ...fill])].slice(0, 3);
}

export default async function ComparePage({ searchParams }: Props) {
  const snap = await safeSnapshot();
  if (!snap) return <Unavailable />;
  const q = await searchParams;
  const slugs = pickSlugs(snap, q);
  const now = snap.generatedAt;
  const cols: Col[] = slugs.map((slug) => {
    const p = snap.providers.find((x) => x.slug === slug)!;
    const list = incidentsFor(snap, p.id);
    return {
      p,
      s30: scoreFor(snap, p.id, 30),
      s90: scoreFor(snap, p.id, 90),
      s1y: scoreFor(snap, p.id, 365),
      trend: monthlyTrend(list, now),
      comms: communication(list.filter((i) => i.startedAt >= now - 90 * 86_400_000), {}),
    };
  });
  const cell = (f: (c: Col) => number | null, fmt: (v: number) => string): Cell[] =>
    cols.map((c) => {
      const v = f(c);
      return { value: v, text: v == null ? "–" : fmt(v) };
    });
  const areas: Area[] = ["production", "shipping", "dashboard"];
  const pct = (v: number) => fmtPct(v);
  const dur = (v: number) => fmtDuration(v);
  const num = (v: number) => String(v);

  const byPoints = [...cols].sort((a, b) => a.s90.points - b.s90.points);
  const byMttr = [...cols].filter((c) => c.s90.medianResolveMinutes != null).sort((a, b) => a.s90.medianResolveMinutes! - b.s90.medianResolveMinutes!);
  const options = snap.categories.map((c) => ({ cat: c, provs: snap.providers.filter((p) => p.category === c.slug) }));

  return (
    <main className="wrap stack" style={{ paddingTop: 24, ["--gap" as string]: "24px", maxWidth: 1080 }}>
      <div className="stack" style={{ ["--gap" as string]: "8px" }}>
        <span className="eyebrow">Compare</span>
        <h1 className="h1 sm" style={{ fontSize: "clamp(36px, 7vw, 64px)" }}>Before you migrate, compare track records.</h1>
        <p className="body" style={{ fontSize: 17 }}>Pick up to three providers. The best value in each row is highlighted. Comparing within one category makes the most sense.</p>
      </div>

      <form className="pickers" action="/compare" method="get">
        {[0, 1, 2].map((k) => (
          <label key={k} className="label">
            Provider {k + 1}
            <select name={["a", "b", "c"][k]} defaultValue={slugs[k] ?? ""}>
              {k === 2 ? <option value="">None</option> : null}
              {options.map(({ cat, provs }) => (
                <optgroup key={cat.slug} label={cat.name}>
                  {provs.map((p) => (
                    <option key={p.slug} value={p.slug}>{p.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        ))}
        <button type="submit" className="btn dark" data-umami-event="compare">Compare</button>
      </form>

      {cols.length < 2 ? (
        <div className="empty">Pick at least two providers.</div>
      ) : (
        <>
          <section className="stack" style={{ ["--gap" as string]: "8px" }}>
            <div className="cmp-cells" style={{ ["--n" as string]: cols.length }}>
              {cols.map((c) => (
                <a key={c.p.slug} href={`/p/${c.p.slug}`} style={{ fontSize: "clamp(18px, 3.5vw, 26px)", fontWeight: 800, overflowWrap: "anywhere" }}>{c.p.name}</a>
              ))}
            </div>
          </section>

          <section className="stack" style={{ ["--gap" as string]: "8px" }}>
            <h2 className="h2">Admitted uptime</h2>
            <div className="box">
              <Row label="Last 30 days" cells={cell((c) => c.s30.admittedUptime, pct)} better="high" />
              <Row label="Last 90 days" cells={cell((c) => c.s90.admittedUptime, pct)} better="high" />
              <Row label="Last 12 months" cells={cell((c) => c.s1y.admittedUptime, pct)} better="high" />
            </div>
          </section>

          <section className="stack" style={{ ["--gap" as string]: "8px" }}>
            <h2 className="h2">Grades (90 days)</h2>
            <div className="box">
              <Row label="Overall" cells={cols.map((c) => ({ text: `${c.s90.grade} · ${c.s90.points.toLocaleString("en-US")} pts`, value: c.s90.points }))} better="low" />
              {areas.map((a) => (
                <Row key={a} label={AREA_LABEL[a]} cells={cols.map((c) => ({ text: c.s90.areas[a].grade, value: Math.round(c.s90.areas[a].points) }))} better="low" />
              ))}
            </div>
          </section>

          <section className="stack" style={{ ["--gap" as string]: "8px" }}>
            <h2 className="h2">Incidents (90 days)</h2>
            <div className="box">
              <Row label="Total incidents" cells={cell((c) => c.s90.incidentCount, num)} better="low" />
              <Row label="Sev 1 · Lights out" cells={cell((c) => c.s90.sevCounts[0], num)} better="low" />
              <Row label="Sev 2 · Bleeding" cells={cell((c) => c.s90.sevCounts[1], num)} better="low" />
              <Row label="Sev 3 · Can't ship" cells={cell((c) => c.s90.sevCounts[2], num)} better="low" />
              <Row label="Sev 4 · Papercut" cells={cell((c) => c.s90.sevCounts[3], num)} better="low" />
              <Row label="Median time to resolve" cells={cell((c) => c.s90.medianResolveMinutes, dur)} better="low" />
              <Row label="Longest incident" cells={cell((c) => c.s90.longestMinutes || null, dur)} better="low" />
              <Row label="Security incidents" cells={cell((c) => c.s90.securityCount, num)} better="low" />
            </div>
          </section>

          <section className="stack" style={{ ["--gap" as string]: "8px" }}>
            <h2 className="h2">Trend and communication</h2>
            <div className="box">
              <Row
                label="Incidents, last 6 months vs 6 before"
                cells={cols.map((c) => {
                  const a = c.trend.slice(0, 6).reduce((n, t) => n + t.count, 0);
                  const b = c.trend.slice(6).reduce((n, t) => n + t.count, 0);
                  return { text: `${b > a ? "Worse" : b < a ? "Better" : "Flat"} (${a} → ${b})`, value: b - a };
                })}
                better="low"
              />
              <Row label="Postmortems for Sev 1–2 (90d)" cells={cols.map((c) => ({ text: `${c.comms.postmortems} of ${c.comms.serious}`, value: c.comms.serious ? c.comms.postmortems / c.comms.serious : null }))} better="high" />
            </div>
          </section>

          <section className="verdict">
            <span className="eyebrow">Summary</span>
            <span style={{ fontSize: "clamp(22px, 4vw, 30px)", fontWeight: 800, lineHeight: 1.15 }}>
              {byPoints[0].p.name} has the best 90-day record
              {byMttr.length ? `; ${byMttr[0].p.name} resolves incidents fastest.` : "."}
            </span>
            <span style={{ fontSize: 16 }}>
              If your app mostly needs to stay up once deployed, weigh the Production grade most. If you ship many times a day, weigh Shipping.
            </span>
          </section>
        </>
      )}
      <p className="muted" style={{ fontSize: 14 }}>Admitted uptime: downtime each provider posted on its own status page. It can under-report.</p>
    </main>
  );
}
