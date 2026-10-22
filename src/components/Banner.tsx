import Link from "next/link";
import type { Snapshot } from "@/lib/data";
import { downNow, liveLevel } from "@/lib/views";
import { fmtAgo, fmtDuration, plural } from "@/lib/format";
import { TIER_NAMES } from "@/lib/severity";
import { STATUS_LABEL } from "@/lib/status";

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
          <strong>All up. For now.</strong>
          <span className="mono" style={{ fontSize: 13 }}>
            {lastEnded ? `Last incident ended ${fmtAgo(lastEnded, snap.generatedAt)}` : `Checked ${fmtAgo(checked, snap.generatedAt)}`}
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className={`banner ${down.some((d) => liveLevel(d) === "down") ? "" : "issues"}`} aria-label="Services with problems right now">
      <div className="tape" />
      <div className="wrap banner-inner">
        <div className="banner-head">
          <span className="eyebrow">
            <span className="dot" />
            {down.some((d) => liveLevel(d) === "down") ? "Down right now" : "Issues right now"}{checked ? ` · checked ${fmtAgo(checked, snap.generatedAt)}` : ""}
          </span>
          <span className="banner-title">
            {plural(down.length, "provider")} reporting problems
          </span>
        </div>
        <div className="banner-cards">
          {down.map((d) => (
            <Link key={d.provider.slug} href={`/p/${d.provider.slug}`} className="down-card" data-umami-event="banner-click" data-umami-event-provider={d.provider.slug}>
              <span className="row" style={{ justifyContent: "space-between", ["--gap" as string]: "8px", alignItems: "baseline" }}>
                <span className="name">{d.provider.name}</span>
                <span className="dur">{fmtDuration((snap.generatedAt - d.sinceMs) / 60_000)}</span>
              </span>
              <span className="what">{d.title}</span>
              <span className={`pill ${d.tier ? `sev-${d.tier}` : "down"}`} style={{ alignSelf: "flex-start" }}>
                {d.tier ? `SEV ${d.tier} · ${TIER_NAMES[d.tier].toUpperCase()}` : STATUS_LABEL[d.status].toUpperCase()}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
