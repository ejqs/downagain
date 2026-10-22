import type { Metadata } from "next";
import Link from "next/link";
import { safeSnapshot } from "@/lib/data";
import { gradeInput, openIncidents, tierOf } from "@/lib/views";
import { durationMinutes } from "@/lib/grading";
import { fmtDay, fmtDuration, fmtTime, plural } from "@/lib/format";
import { TIER_BLURB, TIER_NAMES } from "@/lib/severity";
import { SevPill } from "@/components/ui";
import { pageMeta } from "@/lib/site";
import { Unavailable } from "@/components/Unavailable";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMeta({
  title: "Incidents",
  description: "Every incident posted by the hosting platforms and AI APIs we track, newest first, with severity and duration.",
  path: "/incidents",
});

const PAGE_DAYS = 14;
const DAY = 86_400_000;

type Props = { searchParams: Promise<{ cat?: string; sev?: string; days?: string }> };

export default async function IncidentsPage({ searchParams }: Props) {
  const snap = await safeSnapshot();
  if (!snap) return <Unavailable />;
  const q = await searchParams;
  const cat = snap.categories.some((c) => c.slug === q.cat) ? q.cat! : "all";
  const sev = ["1", "2", "3", "4"].includes(q.sev ?? "") ? Number(q.sev) : 0;
  const days = Math.min(400, Math.max(PAGE_DAYS, Number(q.days) || PAGE_DAYS));
  const byId = new Map(snap.providers.map((p) => [p.id, p]));
  const catName = new Map(snap.categories.map((c) => [c.slug, c.name]));
  const now = snap.generatedAt;

  const keep = (i: (typeof snap.incidents)[number]) => {
    const p = byId.get(i.providerId);
    return p && (cat === "all" || p.category === cat) && (sev === 0 ? tierOf(i) > 0 : tierOf(i) === sev);
  };
  const ongoing = openIncidents(snap.incidents).filter(keep);
  const past = snap.incidents.filter((i) => keep(i) && i.resolvedAt && i.startedAt >= now - days * DAY);

  const groups = new Map<number, typeof past>();
  for (const i of past) {
    const day = Math.floor(i.startedAt / DAY) * DAY;
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(i);
  }

  const week = snap.providers
    .map((p) => ({
      p,
      minutes: snap.incidents
        .filter((i) => i.providerId === p.id && tierOf(i) > 0 && tierOf(i) <= 2 && (i.resolvedAt ?? now) > now - 7 * DAY)
        .reduce((m, i) => m + Math.min(durationMinutes(gradeInput(i), new Date(now)), (now - Math.max(i.startedAt, now - 7 * DAY)) / 60_000), 0),
    }))
    .filter((x) => x.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 5);

  const href = (o: { cat?: string; sev?: number; days?: number }) => {
    const sp = new URLSearchParams();
    const c = o.cat ?? cat;
    const s = o.sev ?? sev;
    if (c !== "all") sp.set("cat", c);
    if (s) sp.set("sev", String(s));
    if (o.days) sp.set("days", String(o.days));
    const str = sp.toString();
    return `/incidents${str ? `?${str}` : ""}`;
  };

  return (
    <main className="wrap stack" style={{ paddingTop: 24, ["--gap" as string]: "24px" }}>
      <div className="stack" style={{ ["--gap" as string]: "8px" }}>
        <h1 className="h1 sm">Incidents</h1>
        <p className="body" style={{ fontSize: 17 }}>Quoted from each provider&apos;s status page.</p>
      </div>

      <div className="stack" style={{ ["--gap" as string]: "8px" }}>
        <div role="group" aria-label="Filter by category" className="chips">
          {[{ slug: "all", name: "All" }, ...snap.categories].map((c) => (
            <Link key={c.slug} href={href({ cat: c.slug })} className="chip" aria-current={c.slug === cat ? "true" : undefined}>
              {c.name}
            </Link>
          ))}
        </div>
        <div role="group" aria-label="Filter by severity" className="chips">
          {[0, 1, 2, 3, 4].map((n) => (
            <Link key={n} href={href({ sev: n })} className="chip small" aria-current={n === sev ? "true" : undefined}>
              {n === 0 ? "Any sev" : `SEV ${n}`}
            </Link>
          ))}
        </div>
      </div>

      <section aria-label="Ongoing" className="box">
        <div className="stack" style={{ padding: "14px 16px", background: ongoing.length ? "var(--down)" : "var(--up-wash)", ["--gap" as string]: "2px" }}>
          <span className="eyebrow">Ongoing</span>
          <span style={{ fontSize: "clamp(22px, 4vw, 28px)", fontWeight: 800 }}>{ongoing.length ? plural(ongoing.length, "open incident") : "All clear"}</span>
        </div>
        {ongoing.map((i) => {
          const p = byId.get(i.providerId)!;
          return (
            <Link key={i.id} href={`/p/${p.slug}`} className="list-row" style={{ textDecoration: "none", ["--gap" as string]: "8px 20px" }}>
              <span className="stack" style={{ flex: "1 1 160px", ["--gap" as string]: "2px" }}>
                <strong style={{ fontSize: 20 }}>{p.name}</strong>
                <span className="muted" style={{ fontSize: 14 }}>{catName.get(p.category)}{i.components.length ? ` · ${i.components.slice(0, 2).join(", ")}` : ""}</span>
              </span>
              <span style={{ flex: "999 1 320px", minWidth: 0, fontSize: 16 }}>{i.title}</span>
              <span className="row" style={{ ["--gap" as string]: "10px" }}>
                <SevPill tier={tierOf(i)} security={i.security} />
                <span className="mono" style={{ fontSize: 20, fontWeight: 700 }}>{fmtDuration((now - i.startedAt) / 60_000)}</span>
              </span>
            </Link>
          );
        })}
      </section>

      <section className="split">
        <div className="main stack" style={{ ["--gap" as string]: "24px" }}>
          {groups.size === 0 ? <div className="empty">Nothing in the last {days} days.</div> : null}
          {[...groups.entries()].map(([day, items]) => (
            <div key={day}>
              <h2 className="day-head">
                {fmtDay(day)}
                <span className="mono muted" style={{ fontSize: 13, fontWeight: 400 }}>{plural(items.length, "incident")}</span>
              </h2>
              {items.map((i) => {
                const p = byId.get(i.providerId)!;
                return (
                  <div key={i.id} className="incident">
                    <span className="when">
                      <span className="mono" style={{ fontSize: 13 }}>{fmtTime(i.startedAt).replace(" UTC", "")}</span>
                      <SevPill tier={tierOf(i)} security={i.security} />
                    </span>
                    <span className="what">
                      <span style={{ fontSize: 17 }}>
                        <Link href={`/p/${p.slug}`} style={{ fontWeight: 800, textDecoration: "none" }}>{p.name}</Link> · {i.title}
                      </span>
                      <span className="muted" style={{ fontSize: 14 }}>
                        {i.components.slice(0, 3).join(", ")}
                        {i.postmortem ? " · postmortem" : ""}
                        {i.url ? (
                          <>
                            {" · "}
                            <a href={i.url} data-umami-event="status-page-outbound">source</a>
                          </>
                        ) : null}
                      </span>
                    </span>
                    <span className="dur">{fmtDuration(durationMinutes(gradeInput(i)))}</span>
                  </div>
                );
              })}
            </div>
          ))}
          {days < 400 ? (
            <Link href={href({ days: days + 30 })} className="btn" style={{ alignSelf: "flex-start" }} scroll={false}>
              Older
            </Link>
          ) : null}
        </div>

        <aside className="side stack" style={{ ["--gap" as string]: "16px" }}>
          <div className="box pad stack">
            <span className="eyebrow">Most Sev 1–2 time, 7d</span>
            {week.length ? (
              week.map((w) => (
                <div key={w.p.slug} className="stack" style={{ ["--gap" as string]: "4px" }}>
                  <div className="row" style={{ justifyContent: "space-between", fontSize: 15 }}>
                    <Link href={`/p/${w.p.slug}`} style={{ fontWeight: 700, textDecoration: "none" }}>{w.p.name}</Link>
                    <span className="mono">{fmtDuration(w.minutes)}</span>
                  </div>
                  <div className="meter hot"><div style={{ width: `${(w.minutes / week[0].minutes) * 100}%` }} /></div>
                </div>
              ))
            ) : (
              <span className="body">Nobody this week. Suspicious.</span>
            )}
          </div>
          <div className="box pad stack" style={{ ["--gap" as string]: "6px" }}>
            <span className="eyebrow">Severity tiers</span>
            {[1, 2, 3, 4].map((t) => (
              <span key={t} style={{ fontSize: 14 }}>
                <strong>Sev {t} · {TIER_NAMES[t]}:</strong> {TIER_BLURB[t].toLowerCase()}
              </span>
            ))}
            <span className="muted" style={{ fontSize: 13 }}>Security bumps one tier. <Link href="/about#severity">How grading works</Link></span>
          </div>
        </aside>
      </section>
    </main>
  );
}
