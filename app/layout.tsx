import type { Metadata, Viewport } from "next";
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: ["content plan", "content calendar", "Framer", "Framer templates", "Framer Marketplace", "build in public", "X", "Contra"],
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: "/",
    locale: "en_GB",
  },
  twitter: { card: "summary_large_image", title: SITE_NAME, description: SITE_DESCRIPTION },
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "black" },
  formatDetection: { telephone: false, email: false, address: false },
  // Private plan: keep it out of search results even if a crawler gets past the lock.
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#161616" },
    { media: "(prefers-color-scheme: dark)", color: "#161616" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;600&family=IBM+Plex+Mono:wght@400&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
