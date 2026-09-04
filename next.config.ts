import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Scoped to Vercel Blob's own domain suffix only -- not a blanket
    // `domains`/wildcard-everything allowance. Every store's public
    // hostname is "<store-id>.public.blob.vercel-storage.com" (see
    // src/lib/images/blob.ts), hence the single-level wildcard.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
    ],
  },
};

export default nextConfig;