import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Banner } from "@/components/Banner";
import { safeSnapshot } from "@/lib/data";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://downagain.dev";

// Every page shows the live banner, so nothing is prerendered at build time (the
// build has no database). Data still comes from the tagged cache, not Postgres.
export const dynamic = "force-dynamic";
const UMAMI_ID = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "downagain.dev · Is it down again?", template: "%s · downagain.dev" },
  description: "Live status and 90-day track records for the hosting platforms and AI APIs your apps run on, from each provider's own status page.",
  openGraph: { siteName: "downagain.dev", type: "website" },
};

export const viewport: Viewport = { themeColor: "#FFD400", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const snap = await safeSnapshot();
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=JetBrains+Mono:wght@400;700&display=swap"
        />
      </head>
      <body>
        <Banner snap={snap} />
        <Header />
        {children}
        <Footer />
        {UMAMI_ID && process.env.NODE_ENV === "production" ? (
          // Proxied through our own domain (see next.config.ts); events go to /stats/api/send.
          <Script src="/stats/script.js" data-website-id={UMAMI_ID} strategy="afterInteractive" />
        ) : null}
      </body>
    </html>
  );
}
