import type { Grade } from "@/lib/grading";
import { TIER_NAMES } from "@/lib/severity";
import type { DayCell } from "@/lib/views";

export function GradeTile({ grade, size, label }: { grade: Grade; size?: "xs" | "md"; label?: string }) {
  const cls = grade === "A+" ? "g-Ap" : `g-${grade}`;
  return (
    <span className={`grade ${size ?? ""} ${cls}`} aria-label={label ?? `Grade ${grade}`}>
      {grade}
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

export function DayStrip({ cells, label, short }: { cells: DayCell[]; label: string; short?: boolean }) {
  const bad = cells.filter((c) => c === "major").length;
  const minor = cells.filter((c) => c === "minor").length;
  return (
    <div className={`strip ${short ? "short" : ""}`} role="img" aria-label={`${label}: ${bad} days with production trouble, ${minor} days with smaller incidents, out of ${cells.length}`}>
      {cells.map((c, i) => (
        <span key={i} className={`c-${c}`} />
      ))}
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

/** A tappable "?" that opens a one-line explanation over the surrounding box. */
export function Hint({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="hint">
      <summary aria-label={`What is ${label}?`}>?</summary>
      <span className="hint-body" role="note">{children}</span>
    </details>
  );
}

export function Stat({ label, value, note, hot, hint }: { label: string; value: string; note?: string; hot?: boolean; hint?: string }) {
  return (
    <div className={`stat ${hot ? "hot" : ""}`}>
      <span className="label" style={hot ? { color: "var(--ink)" } : undefined}>
        {label}
        {hint ? <Hint label={label}>{hint}</Hint> : null}
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
