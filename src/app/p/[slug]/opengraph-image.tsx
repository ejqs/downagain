import { safeSnapshot, type ProviderRow, type Snapshot } from "@/lib/data";
import { dailyCells, dataFrom, downNow, incidentsFor, isGraded, liveLevel, LIVE_LABEL, scoreFor } from "@/lib/views";
import { fmtDuration, fmtPct, plural } from "@/lib/format";
import { TIER_NAMES } from "@/lib/severity";
import { BRAND, GRADE_COLORS } from "@/lib/site";
import { MONO, OG_SIZE, cachedCard, card } from "@/lib/og";

export const dynamic = "force-dynamic";
export const alt = "Provider track record on downagain.dev: 90-day grade, PROD and SHIP grades, downtime and incidents.";
export const size = OG_SIZE;
export const contentType = "image/png";

const CELL: Record<string, string> = { up: BRAND.up, minor: BRAND.minor, major: BRAND.down, none: BRAND.none };

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const snap = await safeSnapshot();
  const p = snap?.providers.find((x) => x.slug === slug);
  // Unknown slugs get a 404, not a fresh render, so made-up URLs cost nothing.
  if (snap && !p) return new Response("not found", { status: 404 });
  if (!snap || !p) {
    return card(
      <div style={{ display: "flex", flex: 1, alignItems: "center", fontSize: 96, letterSpacing: "-0.04em" }}>Is it down again?</div>,
      "90-day track records",
    );
  }
  return cachedCard(`p:${p.slug}`, snap.generatedAt, () => render(snap, p));
}

function render(snap: Snapshot, p: ProviderRow) {
  const s = scoreFor(snap, p.id);
  const cells = dailyCells(incidentsFor(snap, p.id), 90, snap.generatedAt, dataFrom(p));
  const down = downNow(snap).find((d) => d.provider.id === p.id);
  const live = down ? liveLevel(down) : null;
  const grade = isGraded(p, snap.generatedAt) ? s.grade : "–";
  const [gradeBg, gradeFg] = GRADE_COLORS[grade] ?? [BRAND.paper, BRAND.ink];
  const nameSize = p.name.length > 16 ? 76 : 104;

  return card(
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div style={{ display: "flex", flex: 1, gap: 48, alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 16 }}>
          <span style={{ fontFamily: MONO, fontSize: 22, letterSpacing: "0.08em", color: live === "down" ? BRAND.downInk : BRAND.ink }}>
            {down && live ? `${LIVE_LABEL[live]} NOW${down.tier ? ` · SEV ${down.tier} ${TIER_NAMES[down.tier].toUpperCase()}` : ""}` : "LAST 90 DAYS"}
          </span>
          <span style={{ fontSize: nameSize, lineHeight: 0.9, letterSpacing: "-0.04em" }}>{p.name}</span>
          {s.sev1Minutes > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", fontSize: 44, lineHeight: 1.1, gap: "0 12px" }}>
              <span>was down</span>
              <span style={{ background: BRAND.down, padding: "0 10px" }}>{fmtDuration(s.sev1Minutes)}</span>
              <span>in 90 days,</span>
              <span>{`across ${plural(s.incidentCount, "incident")}.`}</span>
            </div>
          ) : (
            <span style={{ fontSize: 44, lineHeight: 1.1 }}>
              {s.incidentCount ? `No Sev 1 downtime in 90 days. ${plural(s.incidentCount, "smaller incident")}.` : "No incidents in 90 days."}
            </span>
          )}
        </div>
        <div
          style={{
            width: 260,
            height: 290,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: gradeBg,
            color: gradeFg,
            border: `6px solid ${BRAND.ink}`,
            boxShadow: `14px 14px 0 ${BRAND.ink}`,
          }}
        >
          <span style={{ fontFamily: MONO, fontSize: 18, letterSpacing: "0.1em" }}>GRADE</span>
          <span style={{ fontSize: grade.length > 1 ? 170 : 210, lineHeight: 0.9 }}>{grade}</span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 3, height: 40, marginTop: 24 }}>
        {cells.map((c, k) => (
          <div key={k} style={{ display: "flex", flex: 1, background: CELL[c] }} />
        ))}
      </div>
    </div>,
    grade === "–" ? "Not enough history to grade yet" : `PROD ${s.areas.production.grade} · SHIP ${s.areas.shipping.grade} · ${fmtPct(s.admittedUptime)} admitted uptime`,
    live === "down" ? "down" : "hazard",
  );
}
