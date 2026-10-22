import Link from "next/link";
import { fmtDate, fmtDuration, fmtMonthShort, plural } from "@/lib/format";
import { GLOSSARY } from "@/lib/glossary";
import { TIER_NAMES } from "@/lib/severity";
import { heatLevel, type DayLoad } from "@/lib/views";
import { Hint, SevPill } from "@/components/ui";

const WEEKDAYS = ["Mon", "", "Wed", "", "Fri", "", ""];
const LEGEND = ["Clean", "Sev 3–4", "Sev 2", "Sev 1"];

export const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const short = (ms: number) => fmtDate(ms).replace(/, \d{4}$/, "");

type Props = {
  days: DayLoad[];
  selected: number | null;
  now: number;
  hrefFor: (day: number | null) => string;
  nameOf: (providerId: number) => string;
};

/** Calendar of the worst incident each UTC day: weeks across, Monday on top. */
export function Heatmap({ days, selected, now, hrefFor, nameOf }: Props) {
  const lead = (new Date(days[0].day).getUTCDay() + 6) % 7;
  const weeks = Math.ceil((lead + days.length) / 7);
  const today = days[days.length - 1].day;
  const sev1Days = days.filter((d) => d.worst === 1).length;
  const clean = days.filter((d) => d.worst === 5).length;
  const picked = selected === null ? null : days.find((d) => d.day === selected) ?? null;

  // Month names over the week that holds the 1st, plus the first week if there's room.
  const months: { col: number; label: string }[] = [];
  days.forEach((d, k) => {
    if (new Date(d.day).getUTCDate() === 1) months.push({ col: Math.floor((lead + k) / 7), label: fmtMonthShort(d.day) });
  });
  if (!months.length || months[0].col >= 3) months.unshift({ col: 0, label: fmtMonthShort(days[0].day) });

  return (
    <section aria-label={`Last ${days.length} days`} className="box pad stack" style={{ position: "relative", ["--gap" as string]: "12px" }}>
      <div className="row" style={{ justifyContent: "space-between", ["--gap" as string]: "4px 12px" }}>
        <span className="eyebrow">
          <Hint label={`Last ${days.length} days`}>{GLOSSARY.heatmap}</Hint>
        </span>
        <span className="mono" style={{ fontSize: 13 }}>
          {plural(sev1Days, "Sev 1 day")} · {clean} clean
        </span>
      </div>
      <div className="cal" style={{ ["--weeks" as string]: weeks }}>
        {months.map((m) => (
          <span key={m.col} className="cal-m" style={{ gridColumn: m.col + 2, gridRow: 1 }}>{m.label}</span>
        ))}
        {WEEKDAYS.map((w, r) => (
          <span key={r} className="cal-w" style={{ gridColumn: 1, gridRow: r + 2 }}>{w}</span>
        ))}
        {days.map((d, k) => {
          const pos = lead + k;
          const on = d.day === selected;
          const label = `${d.day === today ? "Today" : short(d.day)}: ${
            d.incidents ? `${plural(d.incidents, "incident")}, worst Sev ${d.worst} ${TIER_NAMES[d.worst]}` : "clean"
          }`;
          return (
            <Link
              key={d.day}
              href={hrefFor(on ? null : d.day)}
              scroll={false}
              className={`cal-d heat-${heatLevel(d.worst)}${d.day === today ? " today" : ""}`}
              style={{ gridColumn: Math.floor(pos / 7) + 2, gridRow: (pos % 7) + 2 }}
              aria-label={label}
              aria-current={on ? "date" : undefined}
              title={label}
            />
          );
        })}
      </div>
      <div className="legend" style={{ fontSize: 13, ["--gap" as string]: "6px 14px" }}>
        {LEGEND.map((l, k) => (
          <span key={l}><i className={`heat-${k}`} />{l}</span>
        ))}
      </div>
      {picked ? (
        <div className="cal-pick">
          <strong>{picked.day === today ? "Today" : short(picked.day)}</strong>
          {picked.top ? (
            <>
              <span>{nameOf(picked.top.providerId)}</span>
              <SevPill tier={picked.worst} security={picked.top.security} />
              <span className="mono">{fmtDuration(((picked.top.resolvedAt ?? now) - picked.top.startedAt) / 60_000)}</span>
              {picked.incidents > 1 ? <span className="mono muted">+{picked.incidents - 1} more</span> : null}
            </>
          ) : (
            <span>Clean</span>
          )}
          <Link href={hrefFor(null)} scroll={false} className="cal-x" aria-label="All days">×</Link>
        </div>
      ) : null}
    </section>
  );
}
