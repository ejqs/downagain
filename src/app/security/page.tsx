import type { Metadata } from "next";
import Link from "next/link";
import { safeSnapshot } from "@/lib/data";
import { gradeInput, tierOf } from "@/lib/views";
import { durationMinutes } from "@/lib/grading";
import { fmtDate, fmtDuration, fmtMonth, plural } from "@/lib/format";
import { KINDS, KIND_LABEL, securityView, type SecurityKind, type SecurityRow } from "@/lib/security";
import { GLOSSARY } from "@/lib/glossary";
import { SevPill, Stat } from "@/components/ui";
import { pageMeta } from "@/lib/site";
import { Unavailable } from "@/components/Unavailable";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMeta({
  title: "Security incidents",
  description: "Breaches, attacks and emergency patches posted by cloud, hosting, AI and API providers, newest first.",
  path: "/security",
});

const DAY = 86_400_000;
const WINDOW_DAYS = 365;
const BOARD_TOP = 8;

type Props = { searchParams: Promise<{ cat?: string; kind?: string }> };

export default async function SecurityPage({ searchParams }: Props) {
  const snap = await safeSnapshot();
  if (!snap) return <Unavailable />;
  const q = await searchParams;
  const cat = snap.categories.some((c) => c.slug === q.cat) ? q.cat! : "all";
  const kind = (KINDS as string[]).includes(q.kind ?? "") ? (q.kind as SecurityKind) : null;
  const now = snap.generatedAt;
  const from = now - WINDOW_DAYS * DAY;

  const view = securityView(
    { ...snap, incidents: snap.incidents.filter((i) => i.startedAt >= from || !i.resolvedAt) },
    (p) => cat === "all" || p.category === cat,
  );
  const rows = kind ? view.rows.filter((r) => r.kind === kind) : view.rows;
  const counted = view.rows.filter((r) => !r.followUp).length;
  const catName = new Map(snap.categories.map((c) => [c.slug, c.name]));
  const sinceBreach = view.lastBreach ? Math.floor((now - (view.lastBreach.resolvedAt ?? now)) / DAY) : null;

  const months = new Map<string, SecurityRow[]>();
  for (const r of rows) {
    const m = fmtMonth(r.incident.startedAt);
    if (!months.has(m)) months.set(m, []);
    months.get(m)!.push(r);
  }

  const href = (o: { cat?: string; kind?: SecurityKind | null }) => {
    const sp = new URLSearchParams();
    const c = o.cat ?? cat;
    const k = o.kind === undefined ? kind : o.kind;
    if (c !== "all") sp.set("cat", c);
    if (k) sp.set("kind", k);
    const s = sp.toString();
    return `/security${s ? `?${s}` : ""}`;
  };

  return (
    <main className="wrap stack" style={{ paddingTop: 24, ["--gap" as string]: "24px" }}>
      <div className="stack" style={{ ["--gap" as string]: "8px" }}>
        <h1 className="h1 sm">Security</h1>
        <p className="body" style={{ fontSize: 17 }}>Breaches, attacks and emergency patches, quoted from each provider&apos;s status page.</p>
      </div>

      <section className="statline" aria-label="Last 12 months">
        <Stat label="Days without a breach" value={sinceBreach === null ? "–" : String(sinceBreach)} hot hint={GLOSSARY.daysSinceBreach} />
        <Stat label="Breaches, 12 mo" value={String(view.counts.breach)} hint={GLOSSARY.breach} />
        <Stat label="Attacks, 12 mo" value={String(view.counts.attack)} hint={GLOSSARY.attack} />
        <Stat label="Patches, 12 mo" value={String(view.counts.patch)} hint={GLOSSARY.patch} />
      </section>

      <div className="stack" style={{ ["--gap" as string]: "8px" }}>
        <div role="group" aria-label="Filter by category" className="chips">
          {[{ slug: "all", name: "All" }, ...snap.categories].map((c) => (
            <Link key={c.slug} href={href({ cat: c.slug })} className="chip" aria-current={c.slug === cat ? "true" : undefined} scroll={false}>
              {c.name}
            </Link>
          ))}
        </div>
        <div role="group" aria-label="Filter by kind" className="chips">
          {[null, ...KINDS.filter((k) => view.counts[k] || k === kind)].map((k) => (
            <Link key={k ?? "any"} href={href({ kind: k })} className="chip small" aria-current={k === kind ? "true" : undefined} scroll={false}>
              {k ? `${KIND_LABEL[k]} ${view.counts[k]}` : `Any ${counted}`}
            </Link>
          ))}
        </div>
      </div>

      <section className="split">
        <div className="main stack" style={{ ["--gap" as string]: "24px" }}>
          {months.size === 0 ? <div className="empty">{kind === "breach" ? "No breaches in 12 months." : "Nothing in 12 months."}</div> : null}
          {[...months.entries()].map(([m, list]) => (
            <div key={m}>
              <h2 className="day-head">
                {m}
                <span className="mono muted" style={{ fontSize: 13, fontWeight: 400 }}>{plural(list.length, "incident")}</span>
              </h2>
              {list.map((r) => <SecurityLine key={r.incident.id} r={r} cat={catName.get(r.provider.category)} now={now} />)}
            </div>
          ))}
        </div>

        <aside className="side stack" style={{ ["--gap" as string]: "16px" }}>
          {view.board.length ? (
            <section className="box pad stack" aria-label="Who, 12 months" style={{ ["--gap" as string]: "8px" }}>
              <span className="eyebrow">Who, 12 months</span>
              <div className="sec-grid">
                <span className="sec-head" aria-hidden="true">
                  <span />
                  <span>Breach</span>
                  <span>Attack</span>
                  <span>Patch</span>
                  <span>Other</span>
                </span>
                {view.board.slice(0, BOARD_TOP).map((t) => (
                  <Link key={t.provider.slug} href={`/p/${t.provider.slug}`} className="sec-row">
                    <span className="who-name">
                      <strong>{t.provider.name}</strong>
                      <span className="muted">Last {fmtDate(t.last).replace(/, \d{4}$/, "")}</span>
                    </span>
                    {KINDS.map((k) => (
                      <span key={k} className={`mono ${k === "breach" && t.counts.breach ? "hot" : ""}`}>{t.counts[k] || "·"}</span>
                    ))}
                  </Link>
                ))}
              </div>
              {view.board.length > BOARD_TOP ? <span className="muted" style={{ fontSize: 14 }}>+{plural(view.board.length - BOARD_TOP, "provider")}</span> : null}
            </section>
          ) : null}
          <div className="box pad stack" style={{ ["--gap" as string]: "6px" }}>
            <span className="eyebrow">Kinds</span>
            {KINDS.map((k) => (
              <span key={k} style={{ fontSize: 14 }}>
                <strong>{KIND_LABEL[k]}:</strong> {GLOSSARY[k]}
              </span>
            ))}
            <span className="muted" style={{ fontSize: 13 }}><Link href="/about#severity">How grading works</Link></span>
          </div>
        </aside>
      </section>
    </main>
  );
}

function SecurityLine({ r, cat, now }: { r: SecurityRow; cat?: string; now: number }) {
  const i = r.incident;
  return (
    <div className="incident">
      <span className="when">
        <span className="mono" style={{ fontSize: 13 }}>{fmtDate(i.startedAt).replace(/, \d{4}$/, "")}</span>
        <span className={`pill kind-${r.kind}`}>{KIND_LABEL[r.kind].toUpperCase()}{r.followUp ? " · FOLLOW-UP" : ""}</span>
        <SevPill tier={tierOf(i)} />
      </span>
      <span className="what">
        <span style={{ fontSize: 17 }}>
          <Link href={`/p/${r.provider.slug}`} style={{ fontWeight: 800, textDecoration: "none" }}>{r.provider.name}</Link> · {i.title}
        </span>
        {i.summary ? <span style={{ fontSize: 15 }}>{i.summary}</span> : null}
        <span className="muted" style={{ fontSize: 14 }}>
          {cat}
          {i.postmortem ? " · postmortem" : ""}
          {i.url ? (
            <>
              {" · "}
              <a href={i.url} data-umami-event="status-page-outbound">source</a>
            </>
          ) : null}
        </span>
      </span>
      <span className="dur">{i.resolvedAt ? fmtDuration(durationMinutes(gradeInput(i))) : `open ${fmtDuration((now - i.startedAt) / 60_000)}`}</span>
    </div>
  );
}
