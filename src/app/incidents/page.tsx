import type { Metadata } from "next";
import Link from "next/link";
import { safeSnapshot, type IncidentRow, type ProviderRow } from "@/lib/data";
import { LIVE_DAYS, brokenComponents, dailyLoad, downNow, foldByProvider, foldStats, gradeInput, openIncidents, tierOf, whereHit, windowBoard, type WindowRow } from "@/lib/views";
import { WINDOW_DAYS, durationMinutes } from "@/lib/grading";
import { fmtDate, fmtDay, fmtDuration, fmtRange, fmtTime, plural } from "@/lib/format";
import { TIER_BLURB, TIER_NAMES } from "@/lib/severity";
import { GradeTile, SevPill } from "@/components/ui";
import { pageMeta } from "@/lib/site";
import { Unavailable } from "@/components/Unavailable";
import { Heatmap, dayKey } from "@/components/Heatmap";
import { ProviderSelect } from "@/components/ProviderSelect";
import { OutageMap, PlaceBoard } from "@/components/OutageMap";
import { incidentAreas, incidentPlaces, isPlaceKey, outageMap, placeBoard, placeName, placesIn } from "@/lib/places";
import { choicesFor } from "@/lib/needs";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMeta({
  title: "Latest outages and incidents",
  description: "Every outage posted by Vercel, Railway, Netlify, OpenAI, Anthropic and the rest, newest first, with severity and duration.",
  path: "/incidents",
});

const PAGE_DAYS = 14;
const DAY = 86_400_000;

type Props = { searchParams: Promise<{ cat?: string; sev?: string; days?: string; page?: string; day?: string; p?: string; place?: string }> };

export default async function IncidentsPage({ searchParams }: Props) {
  const snap = await safeSnapshot();
  if (!snap) return <Unavailable />;
  const q = await searchParams;
  const cat = snap.categories.some((c) => c.slug === q.cat) ? q.cat! : "all";
  const only = snap.providers.find((p) => p.slug === q.p && (cat === "all" || p.category === cat)) ?? null;
  const sev = ["1", "2", "3", "4"].includes(q.sev ?? "") ? Number(q.sev) : 0;
  // One page is PAGE_DAYS (or ?days= from a place link); page 2 is the stretch before it.
  const days = Math.min(400, Math.max(PAGE_DAYS, Number(q.days) || PAGE_DAYS));
  const page = Math.min(Math.ceil(400 / days), Math.max(1, Math.floor(Number(q.page)) || 1));
  const byId = new Map(snap.providers.map((p) => [p.id, p]));
  const catName = new Map(snap.categories.map((c) => [c.slug, c.name]));
  const now = snap.generatedAt;
  const today = Math.floor(now / DAY) * DAY;
  const picked = /^\d{4}-\d{2}-\d{2}$/.test(q.day ?? "") ? Date.parse(`${q.day}T00:00:00Z`) : NaN;
  const day = picked <= today && picked > today - WINDOW_DAYS * DAY ? picked : null;

  type Row = (typeof snap.incidents)[number];
  const inScope = (i: Row) => {
    const p = byId.get(i.providerId);
    return Boolean(p && (cat === "all" || p.category === cat) && (!only || p.id === only.id));
  };
  const keepAnywhere = (i: Row) => inScope(i) && (sev === 0 ? tierOf(i) > 0 : tierOf(i) === sev);
  // A picked place narrows the lists and the calendar; the map and the place board keep every place.
  const place = isPlaceKey(q.place) ? q.place : null;
  const keep = (i: Row) => keepAnywhere(i) && (!place || incidentPlaces(i).some((x) => x.key === place));
  const to = day === null ? now - (page - 1) * days * DAY : day + DAY;
  const from = day === null ? to - days * DAY : day;
  const inView = (i: Row) => (day === null ? Boolean(i.resolvedAt) && i.startedAt >= from && i.startedAt < to : i.startedAt < to && (i.resolvedAt ?? now) >= from);
  const ongoing = openIncidents(snap.incidents).filter(keep);
  const heat = dailyLoad(snap.incidents.filter(keep), WINDOW_DAYS, now);
  const past = snap.incidents.filter((i) => keep(i) && inView(i));

  const nameOf = (id: number) => byId.get(id)?.name ?? "";
  const ongoingAnywhere = openIncidents(snap.incidents).filter(keepAnywhere);
  const openIds = new Set(ongoingAnywhere.map((i) => i.id));
  const where = outageMap([
    ...ongoingAnywhere.map((i) => ({ places: incidentPlaces(i), areas: incidentAreas(i), provider: nameOf(i.providerId), now: true })),
    ...snap.incidents.filter((i) => keepAnywhere(i) && inView(i) && !openIds.has(i.id)).map((i) => ({ places: incidentPlaces(i), areas: incidentAreas(i), provider: nameOf(i.providerId), now: false })),
    // A status page that's red with no incident open: its broken components may name places.
    ...downNow(snap)
      .filter((d) => (cat === "all" || d.provider.category === cat) && (!only || d.provider.id === only.id))
      .filter((d) => !ongoingAnywhere.some((i) => i.providerId === d.provider.id))
      .flatMap((d) => brokenComponents(d.provider).items.map((c) => ({ places: placesIn(c.name), provider: d.provider.name, now: true, incident: false }))),
  ]);

  const places = placeBoard(snap.incidents.filter(inScope), now, WINDOW_DAYS, nameOf);
  const placeLabel = place ? (where.points.find((x) => x.key === place)?.name ?? placeName(place)) : null;
  // The leaderboard's own region filter, when the picked place falls in one of its regions.
  const boardCat = cat === "all" ? (snap.categories[0]?.slug ?? "hosting") : cat;
  const boardRegion = place ? choicesFor(boardCat).regions.find((r) => r.re.test(placeLabel!) || where.points.find((x) => x.key === place)?.aka.some((a) => r.re.test(a))) : undefined;
  const boardHref = boardRegion ? `${boardCat === snap.categories[0]?.slug ? "/" : `/c/${boardCat}`}?region=${boardRegion.key}` : null;

  const groups = new Map<number, typeof past>();
  for (const i of past) {
    const start = Math.floor(i.startedAt / DAY) * DAY;
    if (!groups.has(start)) groups.set(start, []);
    groups.get(start)!.push(i);
  }

  const older = day === null && page < Math.ceil(400 / days) && snap.incidents.some((i) => keep(i) && i.startedAt < from);
  const span = day !== null ? fmtDate(day).replace(/, \d{4}$/, "") : page === 1 ? `last ${days} days` : fmtRange(from, to - 1);
  const board = only
    ? null
    : windowBoard(
        snap,
        snap.providers.filter((p) => cat === "all" || p.category === cat),
        snap.incidents.filter(keep),
        from,
        to,
      );

  const href = (o: { cat?: string; sev?: number; page?: number; day?: number | null; place?: string | null; p?: string }) => {
    const sp = new URLSearchParams();
    const c = o.cat ?? cat;
    const s = o.sev ?? sev;
    if (c !== "all") sp.set("cat", c);
    if (o.p) sp.set("p", o.p);
    else if (only && o.cat === undefined) sp.set("p", only.slug);
    if (s) sp.set("sev", String(s));
    const d = o.day === undefined ? day : o.day;
    if (d !== null) sp.set("day", dayKey(d));
    else {
      if (days !== PAGE_DAYS) sp.set("days", String(days));
      if (o.page && o.page > 1) sp.set("page", String(o.page));
    }
    const pl = o.place === undefined ? place : o.place;
    if (pl) sp.set("place", pl);
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
        <ProviderSelect
          value={only?.slug ?? ""}
          keep={Object.fromEntries([...(cat !== "all" ? [["cat", cat]] : []), ...(sev ? [["sev", String(sev)]] : []), ...(place ? [["place", place]] : [])])}
          groups={snap.categories
            .filter((c) => cat === "all" || c.slug === cat)
            .map((c) => ({ name: c.name, provs: snap.providers.filter((p) => p.category === c.slug).map((p) => ({ slug: p.slug, name: p.name })) }))
            .filter((g) => g.provs.length)}
        />
        {place ? (
          <div role="group" aria-label="Place" className="chips">
            <Link href={href({ place: null })} className="chip small" aria-current="true" aria-label={`${placeLabel}, clear`} scroll={false}>
              {placeLabel} ×
            </Link>
            {boardHref ? (
              <Link href={boardHref} className="chip small">{boardRegion!.label} leaderboard</Link>
            ) : null}
          </div>
        ) : null}
      </div>

      <section aria-label="Ongoing" className="box">
        <div className="stack" style={{ padding: "14px 16px", background: ongoing.length ? "var(--down)" : "var(--up-wash)", ["--gap" as string]: "2px" }}>
          <span className="eyebrow">Ongoing</span>
          <span style={{ fontSize: "clamp(22px, 4vw, 28px)", fontWeight: 800 }}>{ongoing.length ? plural(ongoing.length, "open incident") : "All clear"}</span>
        </div>
        {foldByProvider(ongoing).map((list) => {
          const p = byId.get(list[0].providerId)!;
          if (list.length === 1) return <OngoingRow key={list[0].id} i={list[0]} p={p} cat={catName.get(p.category)} now={now} />;
          const f = foldStats(list, now);
          const where = [...new Set(list.flatMap((i) => incidentPlaces(i).map((x) => x.name)))];
          return (
            <details key={list[0].id} className="fold">
              <summary className="list-row" style={{ ["--gap" as string]: "8px 20px" }}>
                <span className="stack" style={{ flex: "1 1 160px", ["--gap" as string]: "2px" }}>
                  <strong style={{ fontSize: 20 }}>{p.name}</strong>
                  <span className="muted" style={{ fontSize: 14 }}>{[catName.get(p.category), f.carrier ? `${f.carrier} carrier network` : null].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="stack" style={{ flex: "999 1 320px", minWidth: 0, ["--gap" as string]: "2px" }}>
                  <span className="fold-n" style={{ fontSize: 16, fontWeight: 700 }}>{plural(list.length, "open incident")}</span>
                  {where.length ? <span style={{ fontSize: 16 }}>{where.length > 6 ? `${where.slice(0, 6).join(", ")} +${where.length - 6}` : where.join(", ")}</span> : null}
                </span>
                <span className="row" style={{ ["--gap" as string]: "10px" }}>
                  <SevPill tier={f.tier} security={f.security} />
                  <span className="mono" style={{ fontSize: 20, fontWeight: 700 }}>{fmtDuration((now - Math.min(...list.map((i) => i.startedAt))) / 60_000)}</span>
                </span>
              </summary>
              <div className="fold-items">
                {list.map((i) => <OngoingRow key={i.id} i={i} p={p} cat={catName.get(p.category)} now={now} />)}
              </div>
            </details>
          );
        })}
      </section>

      <section className="split">
        <div className="main stack" style={{ ["--gap" as string]: "24px" }}>
          {board && board.rows.length ? <WhoBoard rows={board.rows} clean={board.clean} label={`Who, ${span}`} hrefFor={(slug) => href({ p: slug })} /> : null}
          <OutageMap
            map={where}
            label={`Where, ${span}`}
            selected={place}
            hrefFor={(k) => href({ place: k === place ? null : k })}
          />
          <Heatmap days={heat} selected={day} now={now} hrefFor={(d) => href({ day: d })} nameOf={(id) => byId.get(id)?.name ?? ""} />
          {groups.size === 0 ? <div className="empty">{day !== null ? "Clean day." : page === 1 ? `Nothing in the last ${days} days.` : "Nothing here."}</div> : null}
          {[...groups.entries()].map(([d, items]) => (
            <div key={d}>
              <h2 className="day-head">
                {fmtDay(d)}
                <span className="mono muted" style={{ fontSize: 13, fontWeight: 400 }}>{plural(items.length, "incident")}</span>
              </h2>
              {foldByProvider(items).map((list) => {
                const p = byId.get(list[0].providerId)!;
                if (list.length === 1) return <IncidentLine key={list[0].id} i={list[0]} p={p} />;
                const f = foldStats(list, now);
                return (
                  <details key={list[0].id} className="fold">
                    <summary className="incident">
                      <span className="when">
                        <span className="mono" style={{ fontSize: 13 }}>{fmtTime(list[0].startedAt).replace(" UTC", "")}</span>
                        <SevPill tier={f.tier} security={f.security} />
                      </span>
                      <span className="what">
                        <span style={{ fontSize: 17 }}>
                          <strong>{p.name}</strong> · <span className="fold-n">{plural(list.length, "incident")}</span>
                        </span>
                        <span className="muted" style={{ fontSize: 14 }}>
                          {f.carrier === list.length ? "Carrier network" : f.carrier ? `${f.carrier} carrier network` : whereHit({ regions: [...new Set(list.flatMap((i) => i.regions ?? []))], components: [...new Set(list.flatMap((i) => i.components))] })}
                        </span>
                      </span>
                      <span className="dur">{fmtDuration(f.minutes)}</span>
                    </summary>
                    <div className="fold-items">
                      {list.map((i) => <IncidentLine key={i.id} i={i} p={p} />)}
                    </div>
                  </details>
                );
              })}
            </div>
          ))}
          {page > 1 || older ? (
            <div className="row" style={{ ["--gap" as string]: "12px" }}>
              {page > 1 ? <Link href={href({ page: page - 1 })} className="btn" scroll={false}>Newer</Link> : null}
              {older ? <Link href={href({ page: page + 1 })} className="btn" scroll={false}>Older</Link> : null}
            </div>
          ) : null}
        </div>

        <aside className="side stack" style={{ ["--gap" as string]: "16px" }}>
          <PlaceBoard rows={places} label="Most Sev 1–2 time by place, 90d" hrefFor={(k) => href({ place: k })} />
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

type Incident = IncidentRow;
type Provider = Pick<ProviderRow, "slug" | "name">;

function OngoingRow({ i, p, cat, now }: { i: Incident; p: Provider; cat?: string; now: number }) {
  return (
    <Link href={`/p/${p.slug}`} className="list-row" style={{ textDecoration: "none", ["--gap" as string]: "8px 20px" }}>
      <span className="stack" style={{ flex: "1 1 160px", ["--gap" as string]: "2px" }}>
        <strong style={{ fontSize: 20 }}>{p.name}</strong>
        <span className="muted" style={{ fontSize: 14 }}>{[cat, whereHit(i, 2)].filter(Boolean).join(" · ")}</span>
      </span>
      <span style={{ flex: "999 1 320px", minWidth: 0, fontSize: 16 }}>{i.title}</span>
      <span className="row" style={{ ["--gap" as string]: "10px" }}>
        <SevPill tier={tierOf(i)} security={i.security} />
        <span className="mono" style={{ fontSize: 20, fontWeight: 700 }}>
          {i.startedAt >= now - LIVE_DAYS * DAY ? fmtDuration((now - i.startedAt) / 60_000) : `since ${fmtDate(i.startedAt)}`}
        </span>
      </span>
    </Link>
  );
}

function IncidentLine({ i, p }: { i: Incident; p: Provider }) {
  return (
    <div className="incident">
      <span className="when">
        <span className="mono" style={{ fontSize: 13 }}>{fmtTime(i.startedAt).replace(" UTC", "")}</span>
        <SevPill tier={tierOf(i)} security={i.security} />
      </span>
      <span className="what">
        <span style={{ fontSize: 17 }}>
          <Link href={`/p/${p.slug}`} style={{ fontWeight: 800, textDecoration: "none" }}>{p.name}</Link> · {i.title}
        </span>
        <span className="muted" style={{ fontSize: 14 }}>
          {whereHit(i)}
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
}

const BOARD_TOP = 5;

/** Who had incidents in the window shown: grade, count, Sev 1–2 time. */
function WhoBoard({ rows, clean, label, hrefFor }: { rows: WindowRow[]; clean: Provider[]; label: string; hrefFor: (slug: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.majorMinutes));
  const line = (r: WindowRow) => (
    <Link key={r.provider.slug} href={hrefFor(r.provider.slug)} className="who-row">
      <GradeTile grade={r.grade} size="xs" />
      <span className="who-name">
        <strong>{r.provider.name}</strong>
        {r.carrier ? <span className="muted">{r.carrier} carrier network</span> : null}
        <span className="meter hot"><span style={{ width: `${(r.majorMinutes / max) * 100}%` }} /></span>
      </span>
      <span className="mono">{r.incidents}</span>
      <span className="mono">{r.majorMinutes ? fmtDuration(r.majorMinutes) : "0m"}</span>
    </Link>
  );
  return (
    <section className="box pad stack who" aria-label={label} style={{ ["--gap" as string]: "8px" }}>
      <span className="eyebrow">{label}</span>
      <div className="who-grid">
        <span className="who-head" aria-hidden="true">
          <span />
          <span />
          <span>Incidents</span>
          <span>Sev 1–2</span>
        </span>
        {rows.slice(0, BOARD_TOP).map(line)}
      </div>
      {rows.length > BOARD_TOP ? (
        <details className="who-more">
          <summary>+{rows.length - BOARD_TOP} more</summary>
          <div className="who-grid">{rows.slice(BOARD_TOP).map(line)}</div>
        </details>
      ) : null}
      {clean.length ? (
        <span style={{ fontSize: 15 }}>
          <strong>Clean:</strong> {clean.length > 8 ? plural(clean.length, "provider") : clean.map((p) => p.name).join(", ")}
        </span>
      ) : null}
    </section>
  );
}
