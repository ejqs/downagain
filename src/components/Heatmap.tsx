import Link from "next/link";
import { fmtDate, fmtMonthShort, plural } from "@/lib/format";
import { GLOSSARY } from "@/lib/glossary";
import { TIER_NAMES } from "@/lib/severity";
import { heatLevel, type DayLoad } from "@/lib/views";
import { Hint } from "@/components/ui";

const WEEKDAYS = ["Mon", "", "Wed", "", "Fri", "", ""];

export const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Calendar of severity-weighted trouble: weeks across, Monday first, one cell per UTC day. */
export function Heatmap({ days, selected, hrefFor }: { days: DayLoad[]; selected: number | null; hrefFor: (day: number | null) => string }) {
  const lead = (new Date(days[0].day).getUTCDay() + 6) % 7;
  const weeks = Math.ceil((lead + days.length) / 7);
  const worst = days.reduce((a, b) => (b.points > a.points ? b : a), days[0]);

  // Month names over the week that holds the 1st, plus the first week if there's room.
  const months: { col: number; label: string }[] = [];
  days.forEach((d, k) => {
    if (new Date(d.day).getUTCDate() === 1) months.push({ col: Math.floor((lead + k) / 7), label: fmtMonthShort(d.day) });
  });
  if (!months.length || months[0].col >= 3) months.unshift({ col: 0, label: fmtMonthShort(days[0].day) });

  return (
    <section aria-label="Last 90 days" className="box pad stack" style={{ ["--gap" as string]: "12px" }}>
      <div className="row" style={{ justifyContent: "space-between", ["--gap" as string]: "4px 12px" }}>
        <span className="eyebrow">
          Last {days.length} days
          <Hint label="the heatmap">{GLOSSARY.heatmap}</Hint>
        </span>
        {worst.points > 0 ? (
          <Link href={hrefFor(worst.day)} className="mono" style={{ fontSize: 13 }}>
            Worst: {fmtDate(worst.day).replace(/, \d{4}$/, "")}
          </Link>
        ) : null}
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
          const label = `${fmtDate(d.day).replace(/, \d{4}$/, "")}: ${
            d.incidents ? `${plural(d.incidents, "incident")}, worst Sev ${d.worst} ${TIER_NAMES[d.worst]}` : "clean"
          }`;
          return (
            <Link
              key={d.day}
              href={hrefFor(on ? null : d.day)}
              scroll={false}
              className={`cal-d heat-${heatLevel(d.points)}`}
              style={{ gridColumn: Math.floor(pos / 7) + 2, gridRow: (pos % 7) + 2 }}
              aria-label={label}
              aria-current={on ? "date" : undefined}
              title={label}
            />
          );
        })}
      </div>
      <div className="legend" aria-hidden="true" style={{ fontSize: 13, ["--gap" as string]: "4px" }}>
        <span className="mono">Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <i key={l} className={`heat-${l}`} style={{ margin: 0 }} />
        ))}
        <span className="mono">More</span>
      </div>
    </section>
  );
}

