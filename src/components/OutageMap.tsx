import { GLOSSARY } from "@/lib/glossary";
import { HEIGHT, WIDTH, project } from "@/lib/geo/projection";
import { LAND_PATH } from "@/lib/geo/land";
import { plural } from "@/lib/format";
import type { OutageMap as MapData } from "@/lib/places";
import { Hint } from "@/components/ui";

const LIST = 8;

/** Dotted world map of where incidents hit, with the busiest places listed under it for phones. */
export function OutageMap({ map, label }: { map: MapData; label: string }) {
  const max = Math.max(1, ...map.points.map((p) => p.incidents));
  // Biggest first so smaller dots land on top; open ones on top of everything.
  const drawn = [...map.points].sort((a, b) => Number(a.now) - Number(b.now) || b.incidents - a.incidents);
  const shown = map.points.slice(0, LIST);
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
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${plural(map.points.length, "place")} with incidents`}>
        <path className="land" d={LAND_PATH} />
        {drawn.map((p) => {
          const [x, y] = project(p.lat, p.lon);
          const r = (p.now ? 3 : 1.8) + 2.4 * Math.sqrt(p.incidents / max);
          return (
            <circle key={p.key} className={`pt${p.now ? " now" : ""}`} cx={x} cy={y} r={+r.toFixed(2)}>
              <title>{`${p.name}${p.aka.length ? ` (${p.aka.slice(0, 4).join(", ")})` : ""}: ${p.now ? "down now, " : ""}${plural(p.incidents, "incident")} · ${p.providers.join(", ")}`}</title>
            </circle>
          );
        })}
      </svg>
      {shown.length ? (
        <ul className="map-places">
          {shown.map((p) => (
            <li key={p.key} className={p.now ? "now" : undefined}>
              <span className="dot" />
              <span title={p.aka.length ? p.aka.join(", ") : undefined}>{p.name}</span>
              <span className="mono muted" style={{ fontSize: 13 }}>{p.incidents || "now"}</span>
            </li>
          ))}
          {map.points.length > LIST ? <li className="muted">+{map.points.length - LIST} more</li> : null}
        </ul>
      ) : (
        <span className="body">No places named.</span>
      )}
    </section>
  );
}
