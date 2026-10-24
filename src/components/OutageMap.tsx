import Link from "next/link";
import { GLOSSARY } from "@/lib/glossary";
import { HEIGHT, WIDTH, project } from "@/lib/geo/projection";
import { LAND_PATH } from "@/lib/geo/land";
import { fmtDuration, plural } from "@/lib/format";
import type { OutageMap as MapData, PlaceTime } from "@/lib/places";
import { Hint } from "@/components/ui";

const LIST = 8;

type Props = {
  map: MapData;
  label: string;
  /** Where a place links to; places are plain text without it. */
  hrefFor?: (key: string) => string;
  selected?: string | null;
};

/** Dotted world map of where incidents hit, with the busiest places listed under it for phones. */
export function OutageMap({ map, label, hrefFor, selected = null }: Props) {
  const max = Math.max(1, ...map.points.map((p) => p.incidents));
  // Biggest first so smaller dots land on top; open ones on top of everything.
  const drawn = [...map.points].sort((a, b) => Number(a.now) - Number(b.now) || b.incidents - a.incidents);
  const shown = map.points.slice(0, LIST);
  if (selected && !shown.some((p) => p.key === selected)) {
    const pick = map.points.find((p) => p.key === selected);
    if (pick) shown.push(pick);
  }
  const now = map.points.filter((p) => p.now).length;
  return (
    <section aria-label={label} className="box pad stack map" style={{ ["--gap" as string]: "12px" }}>
      <div className="row" style={{ justifyContent: "space-between", ["--gap" as string]: "4px 12px" }}>
        <span className="eyebrow">
          <Hint label={label}>{GLOSSARY.map}</Hint>
        </span>
        <span className="mono" style={{ fontSize: 13 }}>
          {now ? `${now} down now · ` : ""}
          {plural(map.points.length, "place")}
          {map.unplaced ? ` · ${map.unplaced} with none named` : ""}
        </span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-label={`${plural(map.points.length, "place")} with incidents`}>
        <path className="land" d={LAND_PATH} />
        {drawn.map((p) => {
          const [x, y] = project(p.lat, p.lon);
          const r = (p.now ? 3 : 1.8) + 2.4 * Math.sqrt(p.incidents / max);
          const dot = (
            <circle className={`pt${p.now ? " now" : ""}${p.key === selected ? " on" : ""}`} cx={x} cy={y} r={+r.toFixed(2)}>
              <title>{`${p.name}${p.aka.length ? ` (${p.aka.slice(0, 4).join(", ")})` : ""}: ${p.now ? "down now, " : ""}${plural(p.incidents, "incident")} · ${p.providers.join(", ")}`}</title>
            </circle>
          );
          return hrefFor ? (
            <a key={p.key} href={hrefFor(p.key)} aria-label={p.name}>
              {dot}
            </a>
          ) : (
            <g key={p.key}>{dot}</g>
          );
        })}
      </svg>
      {shown.length ? (
        <ul className="map-places">
          {shown.map((p) => {
            const body = (
              <>
                <span className="dot" />
                <span title={p.aka.length ? p.aka.join(", ") : undefined}>{p.name}</span>
                <span className="mono muted" style={{ fontSize: 13 }}>{p.incidents || "now"}</span>
              </>
            );
            return (
              <li key={p.key} className={p.now ? "now" : undefined}>
                {hrefFor ? (
                  <Link href={hrefFor(p.key)} scroll={false} aria-current={p.key === selected ? "true" : undefined}>{body}</Link>
                ) : (
                  body
                )}
              </li>
            );
          })}
          {map.points.length > shown.length ? <li className="muted">+{map.points.length - shown.length} more</li> : null}
        </ul>
      ) : (
        <span className="body">No places named.</span>
      )}
    </section>
  );
}

/** Places ranked by Sev 1–2 time, for picking where to run. */
export function PlaceBoard({ rows, label, hrefFor, n = 6 }: { rows: PlaceTime[]; label: string; hrefFor?: (key: string) => string; n?: number }) {
  const top = rows.slice(0, n);
  return (
    <div className="box pad stack">
      <span className="eyebrow">
        <Hint label={label}>{GLOSSARY.placeTime}</Hint>
      </span>
      {top.length ? (
        top.map((r) => (
          <div key={r.key} className="stack" style={{ ["--gap" as string]: "4px" }}>
            <div className="row" style={{ justifyContent: "space-between", fontSize: 15 }}>
              {hrefFor ? (
                <Link href={hrefFor(r.key)} scroll={false} style={{ fontWeight: 700, textDecoration: "none" }} title={r.providers.join(", ")}>{r.name}</Link>
              ) : (
                <span style={{ fontWeight: 700 }}>{r.name}</span>
              )}
              <span className="mono">{fmtDuration(r.minutes)}</span>
            </div>
            <div className="meter hot"><div style={{ width: `${(r.minutes / top[0].minutes) * 100}%` }} /></div>
          </div>
        ))
      ) : (
        <span className="body">No Sev 1–2 named a place.</span>
      )}
    </div>
  );
}
