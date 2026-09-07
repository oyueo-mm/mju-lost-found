import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { themeInitScript } from "@/lib/theme/constants";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Phase 31: resolves opengraph-image.png's relative path to an absolute
  // URL for link previews -- VERCEL_PROJECT_PRODUCTION_URL is a Vercel-
  // provided system env var (no manual configuration needed), falling
  // back to localhost for local dev.
  metadataBase: new URL(
    process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000",
  ),
  title: "명지 스마트 분실물 센터",
  description: "MJU Lost & Found",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Phase H-3: blocking (no async/defer) so data-theme/data-accent/
            data-contrast are set on <html> before first paint -- without
            this, the page would flash the default light/blue theme for a
            frame before a saved dark/accent/high-contrast preference
            applies. Reads only localStorage, no network/DB -- see
            src/lib/theme/constants.ts's themeInitScript() for the single
            shared source of this logic (also used, non-serialized, by
            ThemeSettings for a live change). */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
