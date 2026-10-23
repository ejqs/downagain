import { safeSnapshot } from "@/lib/data";
import { scoreFor } from "@/lib/views";
import { fmtPct } from "@/lib/format";
import { BRAND, GRADE_COLORS } from "@/lib/site";
import type { Snapshot } from "@/lib/data";
import { parseFilter } from "@/lib/needs";
import { parseStack } from "@/lib/stack";
import { stackSummary } from "@/lib/stack-score";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function svg(label: string, value: string, bg: string, fg: string) {
  // Monospace-ish width estimate; good enough for short labels.
  const lw = 10 + label.length * 7;
  const vw = 10 + value.length * 7;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + vw}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}">
<rect width="${lw + vw}" height="20" fill="#0E0E10"/><rect x="1" y="1" width="${lw - 1}" height="18" fill="#FFFFFF"/><rect x="${lw}" y="1" width="${vw - 1}" height="18" fill="${bg}"/>
<g font-family="JetBrains Mono,Menlo,monospace" font-size="11" font-weight="700"><text x="6" y="14" fill="#0E0E10">${esc(label)}</text><text x="${lw + 5}" y="14" fill="${fg}">${esc(value)}</text></g></svg>`;
}

const UNKNOWN = svg("downagain", "unknown", "#EEEEEA", "#0E0E10");

/** /badge/stack.svg?u=railway&u=supabase&need=postgres&region=sg: the /stack page in one line. */
function stackBadge(snap: Snapshot, url: URL): string {
  const q = { u: url.searchParams.getAll("u"), need: url.searchParams.getAll("need"), region: url.searchParams.getAll("region") };
  const picks = parseStack(q.u, snap);
  if (!picks.length) return UNKNOWN;
  const s = stackSummary(snap, picks, parseFilter(q));
  const [live] = s.live;
  if (live) {
    const more = s.live.length > 1 ? ` +${s.live.length - 1}` : "";
    return live.level === "down"
      ? svg("stack", `DOWN · ${live.name}${more}`, BRAND.down, BRAND.ink)
      : svg("stack", `ISSUES · ${live.name}${more}`, BRAND.minor, BRAND.ink);
  }
  if (!s.graded) return svg("stack", "too new to grade", BRAND.none, BRAND.ink);
  const [bg, fg] = GRADE_COLORS[s.score.grade];
  return svg("stack", `${s.score.grade} · ${fmtPct(s.score.admittedUptime)} · 90d`, bg, fg);
}

export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const slug = file.replace(/\.svg$/, "");
  const snap = await safeSnapshot();
  const p = snap?.providers.find((x) => x.slug === slug);
  const body = snap && slug === "stack" ? stackBadge(snap, new URL(req.url)) : !snap || !p ? UNKNOWN : (() => {
    const s = scoreFor(snap, p.id);
    const [bg, fg] = GRADE_COLORS[s.grade];
    return svg(p.slug, `${s.grade} · ${fmtPct(s.admittedUptime)} · 90d`, bg, fg);
  })();
  return new Response(body, {
    headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600" },
  });
}
