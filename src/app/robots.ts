import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/", "/api/status.json"], disallow: ["/api/", "/stats/"] },
    sitemap: `${SITE}/sitemap.xml`,
  };
}
