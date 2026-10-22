import type { NextConfig } from "next";

const umamiHost = (process.env.UMAMI_HOST ?? "https://cloud.umami.is").replace(/\/$/, "");
const isDev = process.env.NODE_ENV !== "production";

// No nonces: every page is dynamic anyway, but nonces would mean a proxy on every
// request for little gain on a read-only site with no logins. Analytics come from
// our own origin through /stats, so 'self' covers them.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
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

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
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
  // Serve Umami from our own domain so ad blockers that stop cloud.umami.is
  // still let us count page views.
  async rewrites() {
    return [
      { source: "/stats/script.js", destination: `${umamiHost}/script.js` },
      { source: "/stats/api/send", destination: `${umamiHost}/api/send` },
    ];
  },
};

export default nextConfig;
