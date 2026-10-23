import type { Metadata } from "next";
import Link from "next/link";
import { safeSnapshot, type IncidentRow } from "@/lib/data";
import { WINDOW_DAYS, durationMinutes, score, windowBounds, type Score } from "@/lib/grading";
import { dailyCells, dailyLoad, dataFrom, gradeInput, isGraded, tierOf } from "@/lib/views";
import { fmtDay, fmtDuration, fmtPct, fmtTime, plural } from "@/lib/format";
import { AREA_SHORT, AREAS } from "@/lib/severity";
import { pageMeta } from "@/lib/site";
import { MAX_STACK, parseStack, stackHref, togglePart, stackEntries, type StackPick } from "@/lib/stack";
import { DayStrip, GradeTile, SevPill, StripLegend } from "@/components/ui";
import { Unavailable } from "@/components/Unavailable";
import { Heatmap, dayKey } from "@/components/Heatmap";
import { AddPart, AddProvider } from "@/components/StackControls";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMeta({
  title: "Your stack",
  description: "Grades, admitted uptime and incidents for only the providers, and the parts of them, you use.",
  path: "/stack",
});

const DAY = 86_400_000;
/** Parts shown as chips before the rest go behind the search box. */
const CHIPS = 8;
const PAGE_DAYS = 14;

const EXAMPLES: { label: string; picks: StackPick[] }[] = [
  { label: "Vercel, Supabase, OpenAI", picks: [{ slug: "vercel", parts: [] }, { slug: "supabase", parts: [] }, { slug: "openai", parts: [] }] },
  { label: "Cloudflare Workers, R2", picks: [{ slug: "cloudflare", parts: ["workers", "r2"] }] },
  { label: "Railway, GitHub Actions", picks: [{ slug: "railway", parts: [] }, { slug: "github", parts: ["actions"] }] },
];

type Props = { searchParams: Promise<{ u?: string | string[]; day?: string; days?: string }> };

export default async function StackPage({ searchParams }: Props) {
  const snap = await safeSnapshot();
  if (!snap) return <Unavailable />;
  const q = await searchParams;
  const picks = parseStack(q.u, snap);
  const entries = stackEntries(snap, picks);
  const now = snap.generatedAt;
  const { from, to } = windowBounds(new Date(now));
  const today = Math.floor(now / DAY) * DAY;
  const asked = /^\d{4}-\d{2}-\d{2}$/.test(q.day ?? "") ? Date.parse(`${q.day}T00:00:00Z`) : NaN;
  const days = Math.min(WINDOW_DAYS, Math.max(PAGE_DAYS, Number(q.days) || PAGE_DAYS));
  const day = asked <= today && asked > today - WINDOW_DAYS * DAY ? asked : null;
  const byId = new Map(snap.providers.map((p) => [p.id, p]));
  const inStack = new Set(picks.map((p) => p.slug));
  const examples = EXAMPLES.filter((e) => e.picks.every((p) => snap.providers.some((x) => x.slug === p.slug)));

  const scoreOf = (list: IncidentRow[]) => score(list.map(gradeInput), from, to);
  const rows = entries.map((e) => ({ ...e, score: scoreOf(e.incidents), graded: isGraded(e.provider, now) }));
  const all = entries.flatMap((e) => e.incidents).sort((a, b) => b.startedAt - a.startedAt);
  const whole = rows.length > 1 ? { score: scoreOf(all), graded: rows.every((r) => r.graded) } : null;
  const heat = dailyLoad(all, WINDOW_DAYS, now);
  const list = all.filter((i) =>
    tierOf(i) > 0 && (day === null ? (i.resolvedAt ?? now) > now - days * DAY : i.startedAt < day + DAY && (i.resolvedAt ?? now) >= day),
  );
  const groups = new Map<number, IncidentRow[]>();
  for (const i of list) {
    const start = Math.floor(i.startedAt / DAY) * DAY;
    if (!groups.has(start)) groups.set(start, []);
    groups.get(start)!.push(i);
  }

  const without = (slug: string) => stackHref(picks.filter((p) => p.slug !== slug));

  return (
    <main className="wrap stack" style={{ paddingTop: 24, ["--gap" as string]: "24px" }}>
      <h1 className="h1 sm">Your stack</h1>

      <section aria-label="Providers" className="stack" style={{ ["--gap" as string]: "12px" }}>
        {entries.map((e) => {
          const chips = [...e.picked, ...e.parts.filter((p) => p.count > 0 && !e.pick.parts.includes(p.key)).slice(0, Math.max(0, CHIPS - e.picked.length))];
          const shown = new Set(chips.map((c) => c.key));
          const rest = e.parts.filter((p) => !shown.has(p.key));
          return (
            <div key={e.provider.slug} className="box pad stack" style={{ ["--gap" as string]: "10px" }}>
              <div className="row" style={{ justifyContent: "space-between", ["--gap" as string]: "8px" }}>
                <span className="row" style={{ ["--gap" as string]: "4px 10px", minWidth: 0 }}>
                  <Link href={`/p/${e.provider.slug}`} style={{ fontSize: 20, fontWeight: 800, textDecoration: "none" }}>{e.provider.name}</Link>
                  <span className="muted" style={{ fontSize: 14 }}>{e.provider.kind}</span>
                </span>
                <Link href={without(e.provider.slug)} scroll={false} className="cal-x" aria-label={`Remove ${e.provider.name}`}>×</Link>
              </div>
              {e.parts.length ? (
                <div role="group" aria-label={`${e.provider.name} parts`} className="chips">
                  <Link href={stackHref(togglePart(picks, e.provider.slug, null))} scroll={false} className="chip small" aria-pressed={!e.picked.length}>
                    All
                  </Link>
                  {chips.map((c) => (
                    <Link
                      key={c.key}
                      href={stackHref(togglePart(picks, e.provider.slug, c.key))}
                      scroll={false}
                      className="chip small"
                      aria-pressed={e.pick.parts.includes(c.key)}
                      title={c.group ? `${c.group} · ${plural(c.count, "incident")}` : plural(c.count, "incident")}
                    >
                      {c.name}
                    </Link>
                  ))}
                  {rest.length ? <AddPart slug={e.provider.slug} parts={rest.map((p) => ({ key: p.key, name: p.name }))} picks={picks} /> : null}
                </div>
              ) : null}
            </div>
          );
        })}
        {picks.length < MAX_STACK ? (
          <AddProvider
            picks={picks}
            groups={snap.categories
              .map((c) => ({ name: c.name, provs: snap.providers.filter((p) => p.category === c.slug && !inStack.has(p.slug)).map((p) => ({ slug: p.slug, name: p.name })) }))
              .filter((g) => g.provs.length)}
          />
        ) : null}
      </section>

      {entries.length === 0 ? (
        <section className="stack" style={{ ["--gap" as string]: "12px" }}>
          <div className="empty">An empty stack never goes down.</div>
          {examples.length ? (
            <div className="stack" style={{ ["--gap" as string]: "8px" }}>
              <span className="eyebrow">Examples</span>
              <div className="chips">
                {examples.map((x) => (
                  <Link key={x.label} href={stackHref(x.picks)} className="chip">{x.label}</Link>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        <>
          <section aria-label="Last 90 days" className="stack" style={{ ["--gap" as string]: "14px" }}>
            <div>
              <h2 className="h2">Last 90 days</h2>
            </div>
            <div className="box">
              {whole ? <StackRow name="Whole stack" sub={plural(rows.length, "provider")} score={whole.score} graded={whole.graded} cells={dailyCells(all, 60, now)} /> : null}
              {rows.map((r) => (
                <StackRow
                  key={r.provider.slug}
                  name={r.provider.name}
                  href={`/p/${r.provider.slug}`}
                  sub={r.picked.length ? r.picked.map((p) => p.name).join(", ") : "All"}
                  score={r.score}
                  graded={r.graded}
                  cells={dailyCells(r.incidents, 60, now, dataFrom(r.provider))}
                />
              ))}
            </div>
            <StripLegend />
          </section>

          <section className="stack" style={{ ["--gap" as string]: "24px" }}>
            <Heatmap
              days={heat}
              selected={day}
              now={now}
              hrefFor={(d) => stackHref(picks, d === null ? {} : { day: dayKey(d) })}
              nameOf={(id) => byId.get(id)?.name ?? ""}
            />
            {groups.size === 0 ? <div className="empty">{day === null ? `Nothing in the last ${days} days.` : "Clean day."}</div> : null}
            {[...groups.entries()].map(([d, items]) => (
              <div key={d}>
                <h2 className="day-head">
                  {fmtDay(d)}
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
                          {i.url ? (
                            <>
                              {i.components.length ? " · " : ""}
                              <a href={i.url} data-umami-event="status-page-outbound">source</a>
                            </>
                          ) : null}
                        </span>
                      </span>
                      <span className="dur">{i.resolvedAt ? fmtDuration(durationMinutes(gradeInput(i))) : "ONGOING"}</span>
                    </div>
                  );
                })}
              </div>
            ))}
            {day === null && days < WINDOW_DAYS ? (
              <Link href={stackHref(picks, { days: String(Math.min(WINDOW_DAYS, days + 30)) })} className="btn" style={{ alignSelf: "flex-start" }} scroll={false}>
                Older
              </Link>
            ) : null}
          </section>
        </>
      )}
    </main>
  );
}

function StackRow({ name, href, sub, score: s, graded, cells }: { name: string; href?: string; sub: string; score: Score; graded: boolean; cells: ReturnType<typeof dailyCells> }) {
  return (
    <div className="list-row">
      <div className="board-name">
        <GradeTile grade={graded ? s.grade : null} label={`Overall grade ${s.grade}`} />
        <div className="stack" style={{ ["--gap" as string]: "2px", minWidth: 0 }}>
          {href ? <Link href={href}>{name}</Link> : <strong style={{ fontSize: 19 }}>{name}</strong>}
          <span className="muted" style={{ fontSize: 14, overflowWrap: "anywhere" }}>{sub}</span>
        </div>
      </div>
      <div className="board-metrics">
        <div className="areas" aria-label="Area grades">
          {AREAS.map((a) => (
            <span key={a}>
              <GradeTile grade={graded ? s.areas[a].grade : null} size="xs" label={`${a} grade ${s.areas[a].grade}`} />
              {AREA_SHORT[a]}
            </span>
          ))}
        </div>
        <div className="metric"><b>{graded ? fmtPct(s.admittedUptime) : "–"}</b><span>ADMITTED UPTIME</span></div>
        <div className="metric"><b>{s.incidentCount}</b><span>INCIDENTS</span></div>
        <div className="metric"><b>{s.longestMinutes ? fmtDuration(s.longestMinutes) : "–"}</b><span>LONGEST</span></div>
      </div>
      <DayStrip cells={cells} label={`${name}, last 60 days`} />
    </div>
  );
}
