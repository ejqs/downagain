import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Banner } from "@/components/Banner";
import { JsonLd } from "@/components/JsonLd";
import { safeSnapshot } from "@/lib/data";
import { SITE, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from "@/lib/site";

// Every page shows the live banner, so nothing is prerendered at build time (the
// build has no database). Data still comes from the tagged cache, not Postgres.
export const dynamic = "force-dynamic";
const UMAMI_WEBSITE_ID = "5f60967a-e8ec-4965-85ef-cbcf07e4c968";

// Self-hosted at build time: no request to Google, and size-matched fallbacks so
// text paints at once without shifting when the font arrives.
const display = Bricolage_Grotesque({ subsets: ["latin"], axes: ["opsz"], variable: "--font-bricolage", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: SITE_TITLE, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: { siteName: SITE_NAME, type: "website", locale: "en_US", title: SITE_TITLE, description: SITE_DESCRIPTION },
  twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESCRIPTION },
  formatDetection: { telephone: false },
};

const WEBSITE_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${SITE}/#website`,
  name: SITE_NAME,
  alternateName: "downagain",
  url: `${SITE}/`,
  description: SITE_DESCRIPTION,
  inLanguage: "en",
  publisher: { "@type": "Person", name: "ejqs", url: "https://ejqs.net" },
};

export const viewport: Viewport = { themeColor: "#FFD400", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const snap = await safeSnapshot();
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body>
        <JsonLd data={WEBSITE_LD} />
        <Banner snap={snap} />
        <Header />
        {children}
        <Footer snap={snap} />
        {/* Same setup as roam.pub. Production only, so local runs don't count. */}
        {process.env.NODE_ENV === "production" && (
          <Script
            src="https://cloud.umami.is/script.js"
            data-website-id={UMAMI_WEBSITE_ID}
            data-performance="true"
            strategy="afterInteractive"
          />
        )}
      </body>
    </html>
  );
}
