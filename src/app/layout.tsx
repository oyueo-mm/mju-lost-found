import type { Metadata, Viewport } from "next";
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
  // Phase 11-5: app/manifest.ts is what actually makes /manifest.webmanifest
  // exist and auto-links it -- appleWebApp here only fills in the two
  // iOS-specific bits that manifest.json/PWA spec doesn't cover (iOS
  // Safari has never read the Web App Manifest's `display`/`name` for its
  // own "홈 화면에 추가" flow, only these Apple-specific meta tags).
  // apple-touch-icon itself is unaffected (src/app/apple-icon.png already
  // covers that via Next's own metadata-file convention).
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "명지 분실물",
  },
};

// Phase 11-5: themeColor moved out of `metadata` into its own export --
// Next.js deprecated (and, since a recent version, silently drops)
// metadata.themeColor in favor of this. Reuses this app's own --primary
// token value (globals.css), not a new color. width/initialScale repeat
// Next's own default (this export replaces it entirely once present, so
// they can't be left implicit).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2f6fed",
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
