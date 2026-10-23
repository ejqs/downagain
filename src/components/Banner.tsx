import Link from "next/link";
import type { Snapshot } from "@/lib/data";
import { downNow, worstLevel } from "@/lib/views";
import { fmtAgo, fmtDuration } from "@/lib/format";
import { TIER_NAMES } from "@/lib/severity";
import { STATUS_LABEL } from "@/lib/status";

const HEAD = { down: "Down right now", issues: "Issues right now", monitoring: "Monitoring right now" };

/** The "down right now" banner at the top of every page. */
export function Banner({ snap }: { snap: Snapshot | null }) {
  if (!snap || snap.providers.length === 0) return null;
  const down = downNow(snap);
  const checked = Math.max(0, ...snap.providers.map((p) => p.lastCheckedAt ?? 0));

  if (down.length === 0) {
    const lastEnded = Math.max(0, ...snap.incidents.filter((i) => i.resolvedAt).map((i) => i.resolvedAt!));
    return (
      <section className="allclear" aria-label="All services up">
        <div className="wrap">
          <strong>All up.</strong>
          <span className="mono" style={{ fontSize: 13 }}>
            {lastEnded ? `Last incident ended ${fmtAgo(lastEnded, snap.generatedAt)}` : `Checked ${fmtAgo(checked, snap.generatedAt)}`}
          </span>
        </div>
      </section>
    );
  }

  const level = worstLevel(down);
  return (
    <section className={`banner ${level === "down" ? "" : level}`} aria-label="Services with problems right now">
      <div className="wrap banner-inner">
        <h2 className="banner-head eyebrow">
          <span className="dot" />
          {HEAD[level ?? "issues"]} · {down.length}{checked ? ` · checked ${fmtAgo(checked, snap.generatedAt)}` : ""}
        </h2>
        <div className="banner-cards">
          {down.map((d) => (
            <Link key={d.provider.slug} href={`/p/${d.provider.slug}`} className="down-card" data-umami-event="banner-click" data-umami-event-provider={d.provider.slug}>
              <span className="top">
                <span className="name">
                  {d.provider.name}{" "}
                  <span className={`pill ${d.tier ? `sev-${d.tier}` : "down"}`} title={d.tier ? TIER_NAMES[d.tier] : undefined}>
                    {d.tier ? `SEV ${d.tier}` : STATUS_LABEL[d.status].toUpperCase()}
                  </span>
                  {d.monitoring ? <>{" "}<span className="pill monitoring">MONITORING</span></> : null}
                </span>
                <span className="dur">{fmtDuration((snap.generatedAt - d.sinceMs) / 60_000)}</span>
              </span>
              <span className="what">{d.title}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
