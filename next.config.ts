import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// No nonces: every page is dynamic anyway, but nonces would mean a proxy on every
// request for little gain on a read-only site with no logins. Umami Cloud is the
// one third party: its script from cloud.umami.is posts events to gateway.umami.is.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://cloud.umami.is${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
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
};

export default nextConfig;
