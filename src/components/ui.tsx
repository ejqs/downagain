import type { Grade } from "@/lib/grading";
import { TIER_NAMES } from "@/lib/severity";
import type { DayCell } from "@/lib/views";

/** A null grade is "not enough data yet": shown as a dash. */
export function GradeTile({ grade, size, label }: { grade: Grade | null; size?: "xs" | "md"; label?: string }) {
  const cls = grade === null ? "g-none" : grade === "A+" ? "g-Ap" : `g-${grade}`;
  return (
    <span className={`grade ${size ?? ""} ${cls}`} aria-label={grade === null ? "No grade yet" : (label ?? `Grade ${grade}`)}>
      {grade ?? "–"}
    </span>
  );
}

export function SevPill({ tier, security, long }: { tier: number; security?: boolean; long?: boolean }) {
  const text = tier === 0 ? "NOT COUNTED" : long ? `SEV ${tier} · ${TIER_NAMES[tier].toUpperCase()}` : `SEV ${tier}`;
  return (
    <span className={`pill sev-${tier}`} title={TIER_NAMES[tier]}>
      {text}
      {security ? " · SECURITY" : ""}
    </span>
  );
}

/** A row of days. With tips, each troubled day explains itself on hover or tap. */
export function DayStrip({ cells, label, short, tips }: { cells: DayCell[]; label: string; short?: boolean; tips?: (string | null)[] }) {
  const bad = cells.filter((c) => c === "major").length;
  const minor = cells.filter((c) => c === "minor").length;
  return (
    <div className={`strip ${short ? "short" : ""}`} role="img" aria-label={`${label}: ${bad} days with production trouble, ${minor} days with smaller incidents, out of ${cells.length}`}>
      {cells.map((c, i) => {
        const tip = tips?.[i];
        return tip ? <span key={i} className={`c-${c}`} data-tip={tip} tabIndex={c === "up" ? -1 : 0} aria-label={tip} /> : <span key={i} className={`c-${c}`} />;
      })}
    </div>
  );
}

export function StripLegend() {
  return (
    <div className="legend">
      <span><i className="c-up" />Clean</span>
      <span><i className="c-minor" />Sev 3–4</span>
      <span><i className="c-major" />Sev 1–2</span>
      <span><i className="c-none" />No data</span>
    </div>
  );
}

/** A label you can tap (dotted underline) to open a one-line explanation over the surrounding box. */
export function Hint({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="hint">
      <summary>{label}</summary>
      <span className="hint-body" role="note">{children}</span>
    </details>
  );
}

export function Stat({ label, value, note, hot, hint }: { label: string; value: string; note?: string; hot?: boolean; hint?: string }) {
  return (
    <div className={`stat ${hot ? "hot" : ""}`}>
      <span className="label" style={hot ? { color: "var(--ink)" } : undefined}>
        {hint ? <Hint label={label}>{hint}</Hint> : label}
      </span>
      <span className="value">{value}</span>
      {note ? <span className="note">{note}</span> : null}
    </div>
  );
}

export function CoffeeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9zM16 11h2a3 3 0 0 1 0 6h-2M8 3v3M12 3v3" fill="none" stroke="#0E0E10" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
