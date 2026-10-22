import type { NextConfig } from "next";

const umamiHost = (process.env.UMAMI_HOST ?? "https://cloud.umami.is").replace(/\/$/, "");

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
