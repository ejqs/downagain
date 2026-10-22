import { safeSnapshot, type Snapshot } from "@/lib/data";
import { daysSinceSev1, downNow } from "@/lib/views";
import { BRAND } from "@/lib/site";
import { DISPLAY, MONO, OG_SIZE, cachedCard, card } from "@/lib/og";

export const dynamic = "force-dynamic";
export const alt = "downagain.dev: Is it down again? Live status and track records for hosting platforms and AI APIs.";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  const snap = await safeSnapshot();
  return snap ? cachedCard("home", snap.generatedAt, () => render(snap)) : render(null);
}

function render(snap: Snapshot | null) {
  const down = snap ? downNow(snap) : [];
  const days = snap ? daysSinceSev1(snap) : null;
  const names = down.map((d) => d.provider.name);
  const downText = names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ");

  return card(
    <div style={{ display: "flex", flex: 1, gap: 48, alignItems: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 22 }}>
        <span style={{ fontFamily: MONO, fontSize: 22, letterSpacing: "0.08em" }}>HOSTING &amp; AI API RELIABILITY</span>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 112, lineHeight: 0.92, letterSpacing: "-0.04em" }}>
          <span>Is it down</span>
          <div style={{ display: "flex" }}>
            <span style={{ background: BRAND.hazard, padding: "0 14px" }}>again?</span>
          </div>
        </div>
        {down.length ? (
          <div style={{ display: "flex", alignSelf: "flex-start", gap: 14, alignItems: "center", background: BRAND.down, border: `5px solid ${BRAND.ink}`, padding: "8px 16px", fontSize: 34 }}>
            <span style={{ fontFamily: MONO, fontSize: 20 }}>DOWN NOW</span>
            <span>{downText}</span>
          </div>
        ) : (
          <span style={{ fontSize: 34, color: BRAND.up }}>{snap ? "Everything we track is up right now." : "Live status from official status pages."}</span>
        )}
      </div>
      {days != null ? (
        <div
          style={{
            width: 270,
            height: 300,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            background: BRAND.ink,
            color: BRAND.hazard,
            boxShadow: `14px 14px 0 ${BRAND.hazard}`,
            border: `6px solid ${BRAND.ink}`,
          }}
        >
          <span style={{ fontFamily: MONO, fontSize: 18, letterSpacing: "0.1em" }}>DAYS SINCE A</span>
          <span style={{ fontSize: 170, lineHeight: 0.95, fontFamily: DISPLAY }}>{days}</span>
          <span style={{ fontFamily: MONO, fontSize: 18, letterSpacing: "0.1em" }}>SEV 1 OUTAGE</span>
        </div>
      ) : null}
    </div>,
    snap ? `${snap.providers.length} providers · 90-day track records` : "90-day track records",
    down.length ? "down" : "hazard",
  );
}
