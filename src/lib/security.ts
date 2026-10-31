// The /security page: incidents flagged security, sorted into what happened. Display only;
// grading still reads `security` and `compromise` straight from the incident (severity.ts).
import type { IncidentRow, ProviderRow, Snapshot } from "@/lib/data";
import { continues } from "@/lib/timelines";

export type SecurityKind = "breach" | "attack" | "patch" | "other";

export const KINDS: SecurityKind[] = ["breach", "attack", "patch", "other"];

export const KIND_LABEL: Record<SecurityKind, string> = {
  breach: "Breach",
  attack: "Attack",
  patch: "Patch",
  other: "Other",
};

const ATTACK_RE = /\bddos\b|denial.of.service|\battack|malicious|\babuse|\bbot(?:net)?s?\b|spam|fraud/i;
const PATCH_RE = /\bcve-\d|vulnerab|\bpatch|security (?:update|fix|advisory)|mitigat\w* (?:for|against) (?:a |the )?(?:\w+ )?(?:kernel|cpu|exploit)/i;

/** What a security incident was. A breach is `compromise`, the one kind that costs points. */
export function securityKind(i: Pick<IncidentRow, "title" | "summary" | "compromise">): SecurityKind {
  if (i.compromise) return "breach";
  const text = `${i.title}\n${i.summary ?? ""}`;
  if (ATTACK_RE.test(text)) return "attack";
  if (PATCH_RE.test(text)) return "patch";
  return "other";
}

export interface SecurityRow {
  incident: IncidentRow;
  provider: ProviderRow;
  kind: SecurityKind;
  /** Continues an earlier breach (timelines.ts): shown under it, counted once. */
  followUp: boolean;
}

export interface ProviderTally {
  provider: ProviderRow;
  counts: Record<SecurityKind, number>;
  total: number;
  last: number;
}

const zero = (): Record<SecurityKind, number> => ({ breach: 0, attack: 0, patch: 0, other: 0 });

/** Every security incident in the snapshot, newest first, with per-provider tallies. */
export function securityView(snap: Snapshot, keep: (p: ProviderRow) => boolean = () => true) {
  const byId = new Map(snap.providers.map((p) => [p.id, p]));
  const rows: SecurityRow[] = [];
  for (const i of snap.incidents) {
    const provider = byId.get(i.providerId);
    if (!i.security || !provider || !keep(provider)) continue;
    rows.push({ incident: i, provider, kind: securityKind(i), followUp: false });
  }
  rows.sort((a, b) => a.incident.startedAt - b.incident.startedAt);
  for (const [n, r] of rows.entries()) {
    if (rows.slice(0, n).some((b) => b.kind === "breach" && continues(b.incident, r.incident, snap.generatedAt))) {
      r.kind = "breach";
      r.followUp = true;
    }
  }
  rows.reverse();

  const tallies = new Map<number, ProviderTally>();
  const counts = zero();
  for (const r of rows) {
    if (r.followUp) continue;
    counts[r.kind]++;
    let t = tallies.get(r.provider.id);
    if (!t) tallies.set(r.provider.id, (t = { provider: r.provider, counts: zero(), total: 0, last: 0 }));
    t.counts[r.kind]++;
    t.total++;
    t.last = Math.max(t.last, r.incident.startedAt);
  }
  // Breaches first, then the most incidents, then the most recent.
  const board = [...tallies.values()].sort((a, b) => b.counts.breach - a.counts.breach || b.total - a.total || b.last - a.last);
  // Days without a breach count from the end of its last follow-up.
  const lastBreach = rows.find((r) => r.kind === "breach")?.incident ?? null;
  return { rows, board, counts, lastBreach };
}
