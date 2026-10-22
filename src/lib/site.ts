// Site identity and the metadata every page shares: canonical URL, Open Graph
// and Twitter tags. Share images come from the opengraph-image files.
import type { Metadata } from "next";

export const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://downagain.dev").replace(/\/$/, "");
export const SITE_NAME = "downagain.dev";
export const SITE_TITLE = "downagain.dev · Is it down again?";
export const SITE_DESCRIPTION =
  "Live status and 90-day track records for the hosting platforms and AI APIs your apps run on, from each provider's own status page.";

export const BRAND = {
  ink: "#0E0E10",
  paper: "#FFFFFF",
  hazard: "#FFD400",
  down: "#E8590C",
  downInk: "#C2410C",
  minor: "#FBBF24",
  up: "#0F766E",
  upWash: "#CCE8E4",
  none: "#D4D4D8",
} as const;

/** Background and text colour for each letter grade (same as the badges). */
export const GRADE_COLORS: Record<string, [string, string]> = {
  "A+": [BRAND.up, BRAND.paper],
  A: [BRAND.up, BRAND.paper],
  B: [BRAND.upWash, BRAND.ink],
  C: [BRAND.hazard, BRAND.ink],
  D: [BRAND.down, BRAND.ink],
  F: [BRAND.ink, BRAND.hazard],
};

export const absUrl = (path: string) => `${SITE}${path.startsWith("/") ? path : `/${path}`}`;

/**
 * Title, description, canonical URL and the matching og/twitter tags. `title`
 * goes through the root template ("… · downagain.dev"); share cards get the
 * full title since they show without the template.
 */
export function pageMeta({ title, description, path }: { title?: string; description?: string; path: string }): Metadata {
  const desc = description ?? SITE_DESCRIPTION;
  const full = title ? `${title} · ${SITE_NAME}` : SITE_TITLE;
  return {
    ...(title ? { title } : {}),
    description: desc,
    alternates: { canonical: path },
    openGraph: { siteName: SITE_NAME, type: "website", locale: "en_US", url: path, title: full, description: desc },
    twitter: { card: "summary_large_image", title: full, description: desc },
  };
}
