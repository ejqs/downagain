import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProviderHistory, safeSnapshot, type IncidentRow, type ProviderRow, type ReviewTrace } from "@/lib/data";
import { brokenComponents, communication, dailyCells, downNow, incidentsFor, liveIncidents, monthlyTrend, scoreFor, startHeatmap, tierOf, topComponents, valueBoard } from "@/lib/views";
import { WORKLOADS, checkedMs, fmtUsd, isStale } from "@/lib/pricing";
import { durationMinutes, penaltyMinutes } from "@/lib/grading";
import { fmtAgo, fmtDate, fmtDuration, fmtMonth, fmtMonthShort, fmtPct, fmtTime, plural } from "@/lib/format";
import { AREA_BLURB, AREA_LABEL, AREA_SHORT, AREAS, TIER_NAMES, TIER_BLURB, TIER_WEIGHT, scopeWeight } from "@/lib/severity";
import { STATUS_LABEL, isProblem } from "@/lib/status";
import { gradeInput } from "@/lib/views";
import { DayStrip, GradeTile, SevPill, Hint, Stat, StripLegend } from "@/components/ui";
import { Unavailable } from "@/components/Unavailable";
import { JsonLd } from "@/components/JsonLd";
import { SITE, absUrl, pageMeta } from "@/lib/site";
import { GLOSSARY } from "@/lib/glossary";
import { beatText, priceText } from "@/components/Value";
import { compareHref, comparePath } from "@/lib/compare";

export const dynamic = "force-dynamic";

const WINDOWS = { "30d": 30, "90d": 90, "1y": 365 } as const;
type WindowKey = keyof typeof WINDOWS;
const DAY = 86_400_000;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SEV_COLORS = ["var(--ink)", "var(--down)", "var(--minor)", "var(--rule)"];

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ w?: string; all?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const snap = await safeSnapshot();
  const p = snap?.providers.find((x) => x.slug === slug);
  if (!snap || !p) return { title: "Provider" };
  const s = scoreFor(snap, p.id);
  const down = downNow(snap).find((d) => d.provider.id === p.id);
  const now = down
    ? `${p.name} is reporting a problem right now: ${down.title}.`
    : p.status === "operational"
      ? `${p.name} is up right now.`
      : p.status === "unknown"
        ? `${p.name}'s status page isn't answering.`
        : `${p.name} status: ${STATUS_LABEL[p.status].toLowerCase()}.`;
  return pageMeta({
    // People search "is OpenAI down", not "is OpenAI API down".
    title: `Is ${brand(p.name)} down? ${brand(p.name) === p.name ? "Live" : p.name} status and outage history`,
    description: `${now} Grade ${s.grade} over the last 90 days: ${plural(s.incidentCount, "incident")}, ${fmtPct(s.admittedUptime)} admitted uptime.`,
    path: `/p/${p.slug}`,
  });
}

const brand = (name: string) => name.replace(/ API$/, "");

const SCOPE_LABEL: Record<string, string> = { regional: "regional", local: "one location", subset: "some customers", single: "one model or feature" };

/** One short mono line: who graded it, how wide it was, which components. */
function IncidentTags({ i }: { i: IncidentRow }) {
  const tags = [
    i.tierOverride == null && i.gradedBy === "claude" ? "AI-graded" : null,
    SCOPE_LABEL[i.scope ?? ""] ?? null,
    i.components.length ? `${i.components[0]}${i.components.length > 1 ? ` +${i.components.length - 1}` : ""}` : null,
  ].filter(Boolean);
  if (!tags.length) return null;
  return (
    <span className="mono muted" style={{ fontSize: 12 }} title={i.components.length > 1 ? i.components.join(", ") : undefined}>
      {tags.join(" · ")}
    </span>
  );
}

const MODEL_NAME: Record<string, string> = { "claude-haiku-5-5": "Claude Haiku 5.5", "claude-sonnet-5-5": "Claude Sonnet 5.5", "claude-opus-5-5": "Claude Opus 5.5" };

/** The audit trail behind an AI grade: model, date, the rules' call next to Claude's, and a link to the raw record. */
function WhyGrade({ i, review }: { i: IncidentRow; review: ReviewTrace }) {
  const v = (review.verdict ?? {}) as { scope?: string; confidence?: string; security?: boolean; data_loss?: boolean; rationale?: string };
  const flags = [v.scope, v.confidence ? `${v.confidence} confidence` : null, v.security ? "security" : null, v.data_loss ? "data loss" : null].filter(Boolean);
  return (
    <details className="updates">
      <summary>Why this grade</summary>
      <ol style={{ listStyle: "none", paddingLeft: 0 }}>
        <li>
          <span className="mono" style={{ fontSize: 12 }}>RULES · SEV {review.rulesTier ?? "?"}</span>
          <br />
          {review.rulesReason ?? "Not recorded"}
        </li>
        <li>
          <span className="mono" style={{ fontSize: 12 }}>CLAUDE · SEV {review.tier ?? "?"}{flags.length ? ` · ${flags.join(" · ").toUpperCase()}` : ""}</span>
          <br />
          {v.rationale}
        </li>
        {i.tierOverride != null ? (
          <li>
            <span className="mono" style={{ fontSize: 12 }}>HAND REVIEW · SEV {i.tierOverride}</span>
            <br />
            {i.overrideNote ?? "Overrides both."}
          </li>
        ) : null}
        <li className="mono" style={{ fontSize: 12 }}>
          {MODEL_NAME[review.model] ?? review.model} · prompt v{review.promptVersion} · {fmtDate(review.reviewedAt)} ·{" "}
          <a href={`/api/incidents/${i.id}/review`}>Raw record</a>
        </li>
      </ol>
    </details>
  );
}

function BrokenList({ p }: { p: ProviderRow }) {
  const b = brokenComponents(p);
  const n = b.items.length;
  if (!n) return null;
  const shownGroups = b.groups.slice(0, 3);
  return (
    <div className="list-row stack" style={{ alignItems: "stretch", ["--gap" as string]: "4px" }}>
      <strong style={{ fontSize: 16 }}>{plural(n, "component")} affected</strong>
      <span className="mono" style={{ fontSize: 13 }}>{b.byStatus.map(([st, k]) => `${k} ${STATUS_LABEL[st].toLowerCase()}`).join(" · ")}</span>
      {b.groups.length > 1 ? (
        <span className="muted" style={{ fontSize: 14 }}>
          {shownGroups.map(([g, k]) => `${g} ${k}`).join(" · ")}
          {b.groups.length > 3 ? ` · +${b.groups.length - 3} more` : ""}
        </span>
      ) : null}
      <details className="updates">
        <summary>{n > 1 ? `All ${n}` : "Show"}</summary>
        <ul className="comp-list">
          {b.items.map((c) => (
            <li key={`${c.group}/${c.name}`}>
              <span>{c.name}</span>
              <span className="mono">{STATUS_LABEL[c.status].toLowerCase()}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function IncidentItem({ i, updates, review }: { i: IncidentRow; updates?: { status: string; body: string; postedAt: number }[]; review?: ReviewTrace }) {
  const tier = tierOf(i);
  const mins = durationMinutes(gradeInput(i));
  return (
    <div className="list-row" style={{ alignItems: "baseline", ["--gap" as string]: "6px 20px" }}>
      <div className="row" style={{ flex: "0 1 260px", ["--gap" as string]: "6px 12px" }}>
        <span className="mono" style={{ fontSize: 14 }}>{fmtDate(i.startedAt)}</span>
        <span className="mono" style={{ fontSize: 14, fontWeight: 700 }}>{i.resolvedAt ? fmtDuration(mins) : "ongoing"}</span>
        <SevPill tier={tier} security={i.security} />
      </div>
      <div className="stack" style={{ flex: "1 1 320px", minWidth: 0, ["--gap" as string]: "3px" }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>{i.title}</span>
        <span className="muted" style={{ fontSize: 14 }}>
          {i.tierOverride != null ? `Sev ${i.tierOverride} (reviewed${i.overrideNote ? `: ${i.overrideNote}` : ""})` : (i.summary ?? i.reason)}
          {i.stale ? " Never closed by the provider; counted to its last update." : ""}
        </span>
        <IncidentTags i={i} />
        {review && i.gradedBy === "claude" ? <WhyGrade i={i} review={review} /> : null}
        {updates?.length ? (
          <details className="updates">
            <summary>{plural(updates.length, "update")}</summary>
            <ol>
              {updates.map((u, k) => (
                <li key={k}>
                  <span className="mono" style={{ fontSize: 12 }}>{fmtTime(u.postedAt)} · {u.status}</span>
                  <br />
                  {u.body}
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </div>
      <div className="row" style={{ ["--gap" as string]: "12px" }}>
        {i.postmortem && i.url ? <a href={i.url} style={{ fontSize: 14, fontWeight: 700 }}>Postmortem</a> : null}
        {i.url ? <a href={i.url} style={{ fontSize: 14 }} data-umami-event="status-page-outbound">Source</a> : null}
      </div>
    </div>
  );
}

export default async function ProviderPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { w, all } = await searchParams;
  const snap = await safeSnapshot();
  if (!snap) return <Unavailable />;
  const p = snap.providers.find((x) => x.slug === slug);
  if (!p) notFound();
  const history = await getProviderHistory(slug);
  const cat = snap.categories.find((c) => c.slug === p.category);

  const win: WindowKey = w && w in WINDOWS ? (w as WindowKey) : "90d";
  const s = scoreFor(snap, p.id, WINDOWS[win]);
  const s90 = win === "90d" ? s : scoreFor(snap, p.id, 90);
  const list = incidentsFor(snap, p.id);
  const now = snap.generatedAt;
  const yearList = list.filter((i) => i.startedAt >= now - 365 * 86_400_000);
  const open = liveIncidents(list, now);
  const down = downNow(snap).find((d) => d.provider.id === p.id);
  const lastIncident = list.find((i) => tierOf(i) > 0);
  const trend = monthlyTrend(list, now);
  const maxMonth = Math.max(1, ...trend.map((t) => t.count));
  const half = (a: number, b: number) => trend.slice(a, b).reduce((n, t) => n + t.count, 0);
  const [before, after] = [half(0, 6), half(6, 12)];
  const heat = startHeatmap(yearList);
  const maxHeat = Math.max(1, ...heat.flat());
  const comps = topComponents(yearList);
  const comms = communication(yearList, history?.updates ?? {});
  const totalSev = s.sevCounts.reduce((a, b) => a + b, 0);
  const peers = snap.providers
    .filter((x) => x.category === p.category)
    .map((x) => ({ x, s: scoreFor(snap, x.id) }))
    .sort((a, b) => a.s.points - b.s.points);
  const rivals = peers.map((x) => x.x).filter((x) => x.slug !== p.slug);
  const shown = all ? list : list.slice(0, 20);
  const value = valueBoard(snap, p.category);
  const cost = value.find((v) => v.provider.id === p.id);
  const work = WORKLOADS[p.category];
  const beaten = value.find((v) => v.provider.id === cost?.beatenBy?.id);
  const cheaper = cost?.usd != null ? value.filter((v) => v.usd != null && v.usd < cost.usd!).length : 0;
  const badge = `[![${p.slug} on downagain.dev](${SITE}/badge/${p.slug}.svg)](${SITE}/p/${p.slug})`;
  const catPath = cat && cat.slug !== snap.categories[0]?.slug ? `/c/${cat.slug}` : "/";

  return (
    <main className="wrap stack" style={{ ["--gap" as string]: "40px" }}>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "WebPage",
              "@id": `${absUrl(`/p/${p.slug}`)}#page`,
              url: absUrl(`/p/${p.slug}`),
              name: `Is ${brand(p.name)} down?`,
              isPartOf: { "@id": `${SITE}/#website` },
              ...(p.lastCheckedAt ? { dateModified: new Date(p.lastCheckedAt).toISOString() } : {}),
              about: {
                "@type": "Organization",
                name: brand(p.name),
                ...(p.homepageUrl ? { url: p.homepageUrl } : {}),
                sameAs: [p.statusPageUrl],
              },
            },
            {
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: cat?.name ?? "Leaderboard", item: absUrl(catPath) },
                { "@type": "ListItem", position: 2, name: p.name, item: absUrl(`/p/${p.slug}`) },
              ],
            },
          ],
        }}
      />
      <section className="row" style={{ paddingTop: 24, alignItems: "stretch", ["--gap" as string]: "20px 32px" }}>
        <div className="stack" style={{ flex: "999 1 520px", minWidth: 0 }}>
          <Link href={catPath} className="mono" style={{ fontSize: 13, fontWeight: 700 }}>
            {cat?.name} / {p.kind} / {p.name}
          </Link>
          <div className="row" style={{ ["--gap" as string]: "10px 14px" }}>
            <h1 className="h1" style={{ fontSize: "clamp(48px, 11vw, 88px)" }}>{p.name}</h1>
            {down?.tier ? (
              <span className={`pill sev-${down.tier}`} style={{ fontSize: 12, padding: "4px 8px", border: "2px solid var(--ink)" }}>
                SEV {down.tier} · {TIER_NAMES[down.tier].toUpperCase()} · {fmtDuration((now - down.sinceMs) / 60_000)}
              </span>
            ) : (
              <span className={`pill ${p.status === "major_outage" ? "down" : isProblem(p.status) ? "issues" : p.status === "unknown" ? "unknown" : "ok"}`} style={{ fontSize: 12, padding: "4px 8px", border: "2px solid var(--ink)" }}>
                {STATUS_LABEL[p.status].toUpperCase()}
              </span>
            )}
          </div>
          <p className="body" style={{ fontSize: 17 }}>
            {p.historyFrom ? `Since ${fmtMonth(p.historyFrom)}` : "New"} · {plural(history?.total ?? list.length, "incident")} · {new URL(p.statusPageUrl).host}
            {p.lastCheckedAt ? ` · checked ${fmtAgo(p.lastCheckedAt, now)}` : ""}
          </p>
          <div className="row" style={{ ["--gap" as string]: "8px", marginTop: 4 }}>
            <Link className="btn dark" href={compareHref([p.slug, ...rivals.slice(0, 2).map((x) => x.slug)])} data-umami-event="compare">
              Compare
            </Link>
            <a className="btn" href={p.statusPageUrl} data-umami-event="status-page-outbound">Status page</a>
          </div>
        </div>
        <div className={`big-grade g-${s90.grade === "A+" ? "Ap" : s90.grade}`}>
          <span className="eyebrow" style={{ letterSpacing: "0.1em" }}>Grade</span>
          <span className="letter">{s90.grade}</span>
          <span className="mono" style={{ fontSize: 13, fontWeight: 700 }}>Last 90 days</span>
          <div className="row" style={{ ["--gap" as string]: "8px", marginTop: 10 }}>
            {AREAS.map((a) => (
              <span key={a} className="stack" style={{ alignItems: "center", ["--gap" as string]: "2px" }}>
                <GradeTile grade={s90.areas[a].grade} size="md" label={`${AREA_LABEL[a]} grade ${s90.areas[a].grade}`} />
                <span className="mono" style={{ fontSize: 11, fontWeight: 700 }}>{AREA_SHORT[a]}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {down ? (
        <section className="box" aria-label="Happening now" style={{ background: "var(--down-wash)" }}>
          <div className="list-row" style={{ background: "var(--down)" }}>
            <strong style={{ fontSize: 20 }}>Happening now</strong>
          </div>
          {open
            .filter((i) => tierOf(i) <= 3)
            .map((i) => (
              <IncidentItem key={i.id} i={i} updates={history?.updates[i.id]} review={history?.reviews[i.id]} />
            ))}
          <BrokenList p={p} />
        </section>
      ) : null}

      <section className="stack">
        <div className="row" style={{ justifyContent: "space-between", ["--gap" as string]: "10px 16px" }}>
          <h2 className="h2">Overview</h2>
          <div className="seg" role="group" aria-label="Time window">
            {(Object.keys(WINDOWS) as WindowKey[]).map((k) => (
              <Link key={k} href={k === "90d" ? `/p/${p.slug}` : `/p/${p.slug}?w=${k}`} aria-current={k === win ? "true" : undefined} className="mono" scroll={false}>
                {k}
              </Link>
            ))}
          </div>
        </div>
        <div className="stats">
          <Stat label="Admitted uptime" value={fmtPct(s.admittedUptime, 3)} note={`Grade ${s.grade}`} hint={GLOSSARY.uptime} />
          <Stat label="Incidents" value={String(s.incidentCount)} note={`${s.sevCounts[0]} Sev 1`} hint={GLOSSARY.incidents} />
          <Stat label="Sev 1 downtime" value={fmtDuration(s.sev1Minutes)} hint={GLOSSARY.sev1Downtime} />
          <Stat label="Median fix" value={s.medianResolveMinutes != null ? fmtDuration(s.medianResolveMinutes) : "–"} hint={GLOSSARY.mttr} />
          <Stat label="Longest" value={s.longestMinutes ? fmtDuration(s.longestMinutes) : "–"} hint={GLOSSARY.longest} />
          <Stat
            label="Since last"
            hint={GLOSSARY.sinceLast}
            value={lastIncident ? (lastIncident.resolvedAt ? fmtDuration((now - lastIncident.resolvedAt) / 60_000) : "ongoing") : "–"}
            hot={!lastIncident?.resolvedAt && Boolean(lastIncident)}
          />
        </div>
      </section>

      <section className="stack">
        <h2 className="h2">By area</h2>
        <div className="box">
          {AREAS.map((a) => {
            const areaList = list.filter((i) => i.areaTiers?.[a] != null || (i.tierOverride != null && a === "production"));
            const inWindow = areaList.filter((i) => i.startedAt >= now - WINDOWS[win] * DAY);
            const areaTier = (i: IncidentRow) => i.areaTiers?.[a] ?? tierOf(i);
            // Worst by what it cost the grade, so a long one-model blip ranks below a short global outage.
            const [from, to] = [new Date(now - WINDOWS[win] * DAY), new Date(now)];
            const cost = (i: IncidentRow) => (TIER_WEIGHT[areaTier(i)] ?? 0) * scopeWeight(i.scope) * penaltyMinutes(gradeInput(i), from, to);
            const worst = [...inWindow].sort((x, y) => cost(y) - cost(x) || areaTier(x) - areaTier(y)).slice(0, 3);
            const hit = topComponents(inWindow, 4);
            const at = monthlyTrend(areaList, now);
            const [was, is] = [at.slice(0, 6), at.slice(6)].map((h) => h.reduce((n, t) => n + t.count, 0));
            return (
              <details key={a} className="area">
                <summary className="list-row" style={{ ["--gap" as string]: "10px 24px" }}>
                  <div className="row" style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <GradeTile grade={s.areas[a].grade} />
                    <strong style={{ fontSize: 18 }}>{AREA_LABEL[a]}</strong>
                  </div>
                  <div className="board-metrics">
                    <div className="metric"><b>{s.areas[a].incidents}</b><span>INCIDENTS</span></div>
                    <div className="metric"><b>{fmtDuration(s.areas[a].downtimeMinutes)}</b><span>AFFECTED</span></div>
                  </div>
                  <DayStrip cells={dailyCells(areaList, 60, now, p.historyFrom)} label={`${AREA_LABEL[a]}, last 60 days`} short />
                </summary>
                <div className="area-more stack">
                  <span className="muted" style={{ fontSize: 14 }}>{AREA_BLURB[a]}</span>
                  <div className="stack" style={{ ["--gap" as string]: "6px" }}>
                    <span className="label">Worst, {win}</span>
                    {worst.length ? (
                      worst.map((i) => (
                        <div key={i.id} className="row" style={{ ["--gap" as string]: "4px 10px", alignItems: "baseline" }}>
                          <SevPill tier={areaTier(i)} security={i.security} />
                          <span className="mono" style={{ fontSize: 13 }}>{[fmtDate(i.startedAt), i.resolvedAt ? fmtDuration(durationMinutes(gradeInput(i))) : "ongoing", SCOPE_LABEL[i.scope ?? ""]].filter(Boolean).join(" · ")}</span>
                          <span style={{ fontSize: 15, flex: "1 1 100%", minWidth: 0 }}>
                            {i.url ? <a href={i.url} data-umami-event="status-page-outbound">{i.title}</a> : i.title}
                          </span>
                        </div>
                      ))
                    ) : (
                      <span className="body" style={{ fontSize: 15 }}>Nothing. Nice.</span>
                    )}
                  </div>
                  {hit.length ? (
                    <div className="stack" style={{ ["--gap" as string]: "4px" }}>
                      <span className="label">Most hit</span>
                      {hit.map((c) => (
                        <div key={c.name} className="row" style={{ justifyContent: "space-between", fontSize: 15 }}>
                          <span style={{ overflowWrap: "anywhere", minWidth: 0 }}>{c.name}</span>
                          <span className="mono" style={{ fontSize: 13 }}>{c.count}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <span className="body" style={{ fontSize: 15 }}>
                    {is > was ? <strong>Worse. </strong> : is < was ? <strong>Better. </strong> : null}
                    {is} in the last 6 months, {was} in the 6 before.
                  </span>
                </div>
              </details>
            );
          })}
        </div>
        <StripLegend />
      </section>

      {cost?.price && work ? (
        <section id="cost" className="stack">
          <div className="stack" style={{ ["--gap" as string]: "6px" }}>
            <h2 className="h2">What it costs</h2>
            <div className="body">
              <Hint label={`${work.title}, per month`}>{work.summary}</Hint>
            </div>
          </div>
          <div className="box">
            <div className="list-row" style={{ justifyContent: "space-between" }}>
              <div className="stack" style={{ ["--gap" as string]: "2px", minWidth: 0 }}>
                <strong style={{ fontSize: 18 }}>{cost.price.plan}</strong>
                <span className="muted" style={{ fontSize: 14 }}>
                  {cost.usd == null ? cost.price.note : `${cheaper} of ${value.filter((v) => v.usd != null).length} cheaper${beaten ? ` · ${beatText(cost, beaten)}` : ""}`}
                </span>
              </div>
              <div className="row" style={{ ["--gap" as string]: "8px" }}>
                {cost.bestValue ? <span className="pill value">BEST VALUE</span> : null}
                {cost.usd != null ? (
                  <span className="mono" style={{ fontSize: 28, fontWeight: 800 }}>
                    {priceText(cost)}
                    <span style={{ fontSize: 14 }}>/mo</span>
                  </span>
                ) : null}
              </div>
            </div>
            {cost.price.lines.map((l) => (
              <div key={l.label} className="list-row" style={{ justifyContent: "space-between", flexWrap: "nowrap", padding: "8px 16px", fontSize: 15 }}>
                <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{l.label}</span>
                <span className="mono">{fmtUsd(l.usd)}</span>
              </div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            {cost.usd != null && cost.price.note ? `${cost.price.note} ` : ""}
            <a href={cost.price.source} data-umami-event="pricing-outbound">{new URL(cost.price.source).host}</a> · checked {fmtDate(checkedMs(cost.price))}
            {isStale(cost.price, now) ? " · may be out of date" : ""} ·{" "}
            <a href={`https://github.com/ejqs/downagain/issues/new?title=${encodeURIComponent(`Price for ${p.name}`)}`}>Wrong price?</a>
          </p>
        </section>
      ) : null}

      <section className="split">
        <div className="main stack">
          <h2 className="h2">Trend, last 12 months</h2>
          <p className="body">
            {after > before ? <strong>Worse. </strong> : after < before ? <strong>Better. </strong> : null}
            {after} in the last 6 months, {before} in the 6 before.
          </p>
          <div className="box pad stack" style={{ ["--gap" as string]: "8px" }}>
            <div className="bars" role="img" aria-label={`Incidents per month: ${trend.map((t) => `${fmtMonthShort(t.start)} ${t.count}`).join(", ")}`}>
              {trend.map((t) => (
                <div key={t.start}>
                  <b>{t.count}</b>
                  <span style={{ height: `${(t.count / maxMonth) * 100}%`, background: t.worst <= 2 ? "var(--down)" : t.worst <= 4 ? "var(--minor)" : "var(--ink)" }} />
                </div>
              ))}
            </div>
            <div className="bars-x" aria-hidden="true">
              {trend.map((t) => (
                <span key={t.start}>{fmtMonthShort(t.start)}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="side stack">
          <h2 className="h2">Severity mix</h2>
          <div className="box pad stack" style={{ ["--gap" as string]: "14px" }}>
            <div className="mix" role="img" aria-label={`Sev 1: ${s.sevCounts[0]}, Sev 2: ${s.sevCounts[1]}, Sev 3: ${s.sevCounts[2]}, Sev 4: ${s.sevCounts[3]}`}>
              {totalSev ? s.sevCounts.map((n, k) => <span key={k} style={{ width: `${(n / totalSev) * 100}%`, background: SEV_COLORS[k] }} />) : <span style={{ width: "100%", background: "var(--up)" }} />}
            </div>
            {s.sevCounts.map((n, k) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 15 }}>
                <span style={{ display: "flex", gap: 8, minWidth: 0 }}>
                  <span style={{ flex: "none", width: 14, height: 14, marginTop: 4, border: "1px solid var(--ink)", background: SEV_COLORS[k] }} />
                  <span className="stack" style={{ ["--gap" as string]: "0px", minWidth: 0 }}>
                    <span>Sev {k + 1} · {TIER_NAMES[k + 1]}</span>
                    <span className="muted" style={{ fontSize: 13 }}>{TIER_BLURB[k + 1]}</span>
                  </span>
                </span>
                <span className="mono">{n}</span>
              </div>
            ))}
            {s.securityCount ? <span className="mono" style={{ fontSize: 13 }}>{plural(s.securityCount, "security incident")}</span> : null}
          </div>
        </div>
      </section>

      <section className="split">
        <div className="main stack">
          <h2 className="h2">When it breaks</h2>
          <p className="body">Start times, last 12 months, UTC.</p>
          <div className="box pad heat" role="img" aria-label="Heatmap of incident start times by weekday and hour, UTC">
            {heat.map((row, d) => (
              <div key={d}>
                <span className="d">{DAYS[d]}</span>
                {row.map((n, h) => (
                  <span key={h} className="h" style={{ background: n ? `color-mix(in srgb, var(--down) ${25 + (n / maxHeat) * 75}%, white)` : "var(--rule)" }} />
                ))}
              </div>
            ))}
            <div className="mono muted" style={{ display: "flex", justifyContent: "space-between", paddingLeft: 32, fontSize: 10 }}>
              <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
            </div>
          </div>
        </div>
        <div className="side stack">
          <h2 className="h2">What breaks</h2>
          <div className="box pad stack">
            {comps.length ? (
              comps.map((c) => (
                <div key={c.name} className="stack" style={{ ["--gap" as string]: "4px" }}>
                  <div className="row" style={{ justifyContent: "space-between", fontSize: 15 }}>
                    <span style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{c.name}</span>
                    <span className="mono">{plural(c.count, "incident")}</span>
                  </div>
                  <div className="meter"><div style={{ width: `${(c.count / comps[0].count) * 100}%` }} /></div>
                </div>
              ))
            ) : (
              <span className="body">No components named in the last 12 months.</span>
            )}
          </div>
        </div>
      </section>

      <section className="stack">
        <h2 className="h2">Communication</h2>
        <div className="stats">
          <Stat label="Updates each" value={comms.updatesPerIncident != null ? comms.updatesPerIncident.toFixed(1) : "–"} note="Last 12 months" hint={GLOSSARY.updatesPer} />
          <Stat label="Update gap" value={comms.medianGapMinutes != null ? fmtDuration(comms.medianGapMinutes) : "–"} note="Last 12 months" hint={GLOSSARY.updateGap} />
          <Stat label="Postmortems" value={`${comms.postmortems} of ${comms.serious}`} note="Sev 1–2" hint={GLOSSARY.postmortems} />
        </div>
      </section>

      <section className="stack">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
          <h2 className="h2">Incident history</h2>
          {!all && list.length > shown.length ? <Link href={`/p/${p.slug}?all=1`} style={{ fontWeight: 700, padding: "10px 0" }}>Show all {list.length}</Link> : null}
        </div>
        {shown.length ? (
          <div className="box">
            {shown.map((i) => (
              <IncidentItem key={i.id} i={i} updates={history?.updates[i.id]} review={history?.reviews[i.id]} />
            ))}
          </div>
        ) : (
          <div className="empty">Clean record. So far.</div>
        )}
        {all && history?.older.length ? (
          <>
            <h3 style={{ fontSize: 20 }}>Older than a year</h3>
            <div className="box">
              {history.older.map((i) => (
                <IncidentItem key={i.id} i={i} />
              ))}
            </div>
          </>
        ) : null}
      </section>

      <section className="stack">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
          <h2 className="h2">Peers, 90 days</h2>
          <Link href={compareHref(peers.slice(0, 3).map((x) => x.x.slug))} style={{ fontWeight: 700, padding: "10px 0" }}>Compare</Link>
        </div>
        <div className="peers">
          {peers.map(({ x, s: ps }) => (
            <Link key={x.slug} href={`/p/${x.slug}`} className={`peer ${x.slug === p.slug ? "self" : ""}`}>
              <strong>{x.name}</strong>
              <span>Grade {ps.grade}</span>
              <span>{fmtPct(ps.admittedUptime)} up</span>
              <span>{plural(ps.incidentCount, "incident")}</span>
              <span>MTTR {ps.medianResolveMinutes != null ? fmtDuration(ps.medianResolveMinutes) : "–"}</span>
              {work ? <span>{priceText(value.find((v) => v.provider.id === x.id))}/mo</span> : null}
            </Link>
          ))}
        </div>
        {rivals.length ? (
          <nav className="chips" aria-label={`${p.name} matchups`}>
            {rivals.map((x) => (
              <Link key={x.slug} href={comparePath([p.slug, x.slug])} className="chip small">
                vs {x.name}
              </Link>
            ))}
          </nav>
        ) : null}
      </section>

      <section className="dark-panel">
        <div className="stack" style={{ flex: "1 1 300px", minWidth: 0 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800 }}>README badge</h2>
          <p style={{ fontSize: 15, color: "#D4D4D8" }}>{p.name}&apos;s live grade, for your README.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/badge/${p.slug}.svg`} alt={`${p.name} grade badge`} height={20} loading="lazy" style={{ alignSelf: "flex-start" }} />
          <div className="code">{badge}</div>
        </div>
      </section>
    </main>
  );
}
