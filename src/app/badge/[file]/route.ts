import { safeSnapshot } from "@/lib/data";
import { scoreFor } from "@/lib/views";
import { fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";

const COLORS: Record<string, [string, string]> = {
  "A+": ["#0F766E", "#FFFFFF"],
  A: ["#0F766E", "#FFFFFF"],
  B: ["#CCE8E4", "#0E0E10"],
  C: ["#FFD400", "#0E0E10"],
  D: ["#E8590C", "#0E0E10"],
  F: ["#0E0E10", "#FFD400"],
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function svg(label: string, value: string, bg: string, fg: string) {
  // Monospace-ish width estimate; good enough for short labels.
  const lw = 10 + label.length * 7;
  const vw = 10 + value.length * 7;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + vw}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}">
<rect width="${lw + vw}" height="20" fill="#0E0E10"/><rect x="1" y="1" width="${lw - 1}" height="18" fill="#FFFFFF"/><rect x="${lw}" y="1" width="${vw - 1}" height="18" fill="${bg}"/>
<g font-family="JetBrains Mono,Menlo,monospace" font-size="11" font-weight="700"><text x="6" y="14" fill="#0E0E10">${esc(label)}</text><text x="${lw + 5}" y="14" fill="${fg}">${esc(value)}</text></g></svg>`;
}

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const slug = file.replace(/\.svg$/, "");
  const snap = await safeSnapshot();
  const p = snap?.providers.find((x) => x.slug === slug);
  const body = !snap || !p ? svg("downagain", "unknown", "#EEEEEA", "#0E0E10") : (() => {
    const s = scoreFor(snap, p.id);
    const [bg, fg] = COLORS[s.grade];
    return svg(p.slug, `${s.grade} · ${fmtPct(s.admittedUptime)} · 90d`, bg, fg);
  })();
  return new Response(body, {
    headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=300, s-maxage=300" },
  });
}
