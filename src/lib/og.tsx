// Shared pieces for the share cards (opengraph-image routes). Satori renders a
// subset of CSS: every element with more than one child needs display:flex.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/site";

export const OG_SIZE = { width: 1200, height: 630 };

const fontDir = path.join(process.cwd(), "assets/fonts");
const fonts = Promise.all([readFile(path.join(fontDir, "BricolageGrotesque-ExtraBold.ttf")), readFile(path.join(fontDir, "JetBrainsMono-Bold.ttf"))]);

export const DISPLAY = "Bricolage Grotesque";
export const MONO = "JetBrains Mono";

/** The card frame: thick ink border, hazard tape on top, wordmark at the bottom. */
export async function card(body: React.ReactNode, footer: string, tape: "hazard" | "down" = "hazard") {
  const [display, mono] = await fonts;
  const stripe = tape === "down" ? BRAND.down : BRAND.hazard;
  const image = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: BRAND.paper,
          color: BRAND.ink,
          fontFamily: DISPLAY,
          border: `12px solid ${BRAND.ink}`,
        }}
      >
        <div
          style={{
            display: "flex",
            height: 22,
            borderBottom: `6px solid ${BRAND.ink}`,
            backgroundImage: `repeating-linear-gradient(-45deg, ${BRAND.ink} 0 18px, ${stripe} 18px 36px)`,
          }}
        />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "40px 56px 0" }}>{body}</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 56px 24px", gap: 24 }}>
          <div style={{ display: "flex", fontSize: 34, letterSpacing: "-0.02em" }}>
            downagain<span style={{ color: BRAND.downInk }}>.dev</span>
          </div>
          <div style={{ display: "flex", fontFamily: MONO, fontSize: 20 }}>{footer}</div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: DISPLAY, data: display, weight: 800, style: "normal" },
        { name: MONO, data: mono, weight: 700, style: "normal" },
      ],
    },
  );
  // Send the whole PNG with a Content-Length instead of a chunked stream; some
  // link-preview crawlers give up on streamed images and fall back to a small card.
  const png = await image.arrayBuffer();
  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(png.byteLength),
      // Crawlers fetch these rarely; let a CDN or the crawler hold them briefly.
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}

// Rendering a card costs real CPU, and anyone can request one as often as they
// like. Keep the last render per card and reuse it until the data changes, so
// repeated requests cost a map lookup. One entry per key, so memory stays bounded
// by the number of cards (providers plus home).
const rendered = new Map<string, { version: number; bytes: ArrayBuffer; headers: Headers }>();

export async function cachedCard(key: string, version: number, render: () => Promise<Response>): Promise<Response> {
  let hit = rendered.get(key);
  if (!hit || hit.version !== version) {
    const res = await render();
    hit = { version, bytes: await res.arrayBuffer(), headers: new Headers(res.headers) };
    if (res.ok) rendered.set(key, hit);
  }
  return new Response(hit.bytes, { headers: hit.headers });
}
