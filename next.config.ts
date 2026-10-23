import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// No nonces: every page is dynamic anyway, but nonces would mean a proxy on every
// request for little gain on a read-only site with no logins. Third parties: Umami
// Cloud (script from cloud.umami.is, events to gateway.umami.is) and Cloudflare
// Turnstile (script and iframe from challenges.cloudflare.com) behind "Down for me".
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://cloud.umami.is https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "frame-src https://challenges.cloudflare.com",
  "connect-src 'self' https://cloud.umami.is https://gateway.umami.is",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

// Pages render per request (the build has no database), which Next marks no-store.
// Let the edge share each page for 30s and serve it stale for 60s more while one
// request refreshes it, so a traffic spike renders a page about twice a minute.
// RSC requests (client navigation, and the 307 that adds ?_rsc) keep Next's no-store
// so a cache keyed on the URL never hands out a flight payload or redirect as HTML.
const PAGES = ["/", "/about", "/incidents", "/stack", "/compare", "/compare/:pair", "/p/:slug", "/c/:slug"];
const edgeCache = PAGES.map((source) => ({
  source,
  missing: [{ type: "header" as const, key: "rsc" }],
  headers: [{ key: "Cache-Control", value: "public, max-age=0, s-maxage=30, stale-while-revalidate=60" }],
}));

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      ...edgeCache,
      // Opened directly, an SVG badge is a document; it never needs scripts.
      { source: "/badge/:file", headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; style-src 'unsafe-inline'" }] },
      // Only on the real domain, so a local `next start` never pins localhost to https.
      {
        source: "/:path*",
        has: [{ type: "host", value: "downagain.dev" }],
        headers: [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }],
      },
    ];
  },
};

export default nextConfig;
