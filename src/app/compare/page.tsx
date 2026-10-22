import type { Metadata } from "next";
import { safeSnapshot, type ProviderRow, type Snapshot } from "@/lib/data";
import { communication, incidentsFor, monthlyTrend, scoreFor } from "@/lib/views";
import { fmtDuration, fmtPct } from "@/lib/format";
import { AREA_LABEL, AREAS } from "@/lib/severity";
import type { Score } from "@/lib/grading";
import { Unavailable } from "@/components/Unavailable";
import { pageMeta } from "@/lib/site";
import { ComparePicker } from "@/components/ComparePicker";
import { Hint } from "@/components/ui";
import { GLOSSARY } from "@/lib/glossary";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ p?: string; a?: string; b?: string; c?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const snap = await safeSnapshot();
  const q = await searchParams;
  const asked = snap ? askedSlugs(snap, q) : [];
  if (!snap || asked.length < 2) {
    return pageMeta({
      title: "Compare providers",
      description: "Put up to three hosting platforms or AI APIs side by side: grades, admitted uptime, incidents and time to fix.",
      path: "/compare",
    });
  }
  const names = asked.map((slug) => snap.providers.find((p) => p.slug === slug)!.name);
  return pageMeta({
    title: `${names.join(" vs ")} uptime`,
    description: `${names.join(" vs ")}: 90-day grades, admitted uptime, incidents and time to fix, from each provider's own status page.`,
    path: `/compare?p=${asked.join(",")}`,
  });
}

interface Col {
  p: ProviderRow;
  s30: Score;
  s90: Score;
  s1y: Score;
  trend: { count: number }[];
  comms: ReturnType<typeof communication>;
}

type Cell = { text: string; value: number | null };

function Row({ label, cells, better, hint }: { label: string; cells: Cell[]; better?: "high" | "low"; hint?: string }) {
  const vals = cells.map((c) => c.value).filter((v): v is number => v != null);
  const best = better && vals.length > 1 ? (better === "high" ? Math.max(...vals) : Math.min(...vals)) : null;
  const allSame = vals.length > 1 && vals.every((v) => v === vals[0]);
  return (
    <div className="cmp-row">
      <span className="label">
        {label}
        {hint ? <Hint label={label}>{hint}</Hint> : null}
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

function askedSlugs(snap: Snapshot, q: Awaited<Props["searchParams"]>): string[] {
  const valid = new Set(snap.providers.map((p) => p.slug));
  const asked = (q.p ? q.p.split(",") : [q.a, q.b, q.c]).filter((s): s is string => Boolean(s && valid.has(s)));
  return [...new Set(asked)].slice(0, 3);
}

function pickSlugs(snap: Snapshot, q: Awaited<Props["searchParams"]>): string[] {
  const unique = askedSlugs(snap, q);
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
  const areas = AREAS;
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
        <h1 className="h1 sm" style={{ fontSize: "clamp(36px, 7vw, 64px)" }}>Before you migrate.</h1>
      </div>

      <ComparePicker key={slugs.join(",")} slugs={slugs} options={options} />

      {cols.length < 2 ? (
        <div className="empty">Pick two.</div>
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
              <Row hint={GLOSSARY.uptime} label="Last 30 days" cells={cell((c) => c.s30.admittedUptime, pct)} better="high" />
              <Row label="Last 90 days" cells={cell((c) => c.s90.admittedUptime, pct)} better="high" />
              <Row label="Last 12 months" cells={cell((c) => c.s1y.admittedUptime, pct)} better="high" />
            </div>
          </section>

          <section className="stack" style={{ ["--gap" as string]: "8px" }}>
            <h2 className="h2">Grades (90 days)</h2>
            <div className="box">
              <Row hint={GLOSSARY.grade} label="Overall" cells={cols.map((c) => ({ text: `${c.s90.grade} · ${c.s90.points.toLocaleString("en-US")} pts`, value: c.s90.points }))} better="low" />
              {areas.map((a) => (
                <Row key={a} hint={GLOSSARY[a]} label={AREA_LABEL[a]} cells={cols.map((c) => ({ text: c.s90.areas[a].grade, value: Math.round(c.s90.areas[a].points) }))} better="low" />
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
              <Row hint={GLOSSARY.mttr} label="Median time to resolve" cells={cell((c) => c.s90.medianResolveMinutes, dur)} better="low" />
              <Row hint={GLOSSARY.longest} label="Longest incident" cells={cell((c) => c.s90.longestMinutes || null, dur)} better="low" />
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
      <p className="muted" style={{ fontSize: 14 }}>
        Uptime as admitted on each status page. <a href="/about">How grades work</a>
      </p>
    </main>
  );
}
