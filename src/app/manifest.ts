import type { MetadataRoute } from "next";

// Phase 11-5: Next.js App Router's native manifest file convention -- this
// file alone is what makes /manifest.webmanifest exist and get auto-linked
// into every page's <head> (no route.ts, no manual <link rel="manifest">
// in layout.tsx needed; Next.js discovers app/manifest.ts on its own, the
// same convention icon.svg/apple-icon.png/opengraph-image.png already use
// in this directory). No new npm dependency -- this is a plain Next.js
// built-in.
//
// icon-192.png/icon-512.png (public/) were rasterized once from this app's
// existing src/app/icon.svg brand mark (light-theme colors, since a home-
// screen icon has no dark-mode concept the way an in-app surface does) via
// `sharp`, which was already present in node_modules (next/image's own
// optimizer dependency) -- no new package installed for this. theme_color/
// background_color reuse this app's own --primary/--background token
// values (globals.css), never invented colors.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "명지 스마트 분실물 센터",
    short_name: "명지 분실물",
    description: "명지대학교 학생을 위한 분실물 등록·검색·연락 서비스",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2f6fed",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
