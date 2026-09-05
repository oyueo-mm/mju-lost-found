import type { NextConfig } from "next";

// next.config.ts runs in plain Node at build/start time (never bundled to
// the client), so it can safely read a non-NEXT_PUBLIC_ env var too -- but
// NEXT_PUBLIC_SUPABASE_URL is used here since that's the one already
// guaranteed to exist wherever image uploads work at all (see
// src/lib/images/supabaseAdmin.ts). Guarded so a missing env var during a
// config-only build (e.g. CI without secrets) doesn't crash next.config.ts
// itself -- next/image would just have no matching remotePattern, and any
// <Image> pointed at a real Supabase URL would fail its own check lazily
// at render time instead, the same "warn/fail lazily, don't crash at
// import/build time" pattern used elsewhere (prisma.ts, supabaseAdmin.ts).
function supabaseStorageRemotePattern() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    const { hostname } = new URL(url);
    return {
      protocol: "https" as const,
      hostname,
      pathname: "/storage/v1/object/public/**",
    };
  } catch {
    return null;
  }
}

const supabasePattern = supabaseStorageRemotePattern();

const nextConfig: NextConfig = {
  // Two things Vercel/Next's static file tracer won't discover on its own
  // for src/lib/ai/embedding.ts's TransformersEmbeddingProvider -- both
  // confirmed missing by a real Vercel deployment (Phase 6), not guessed:
  //
  // 1. onnxruntime-node's native addon (.node) dlopen()s a sibling
  //    libonnxruntime.so.1 at runtime rather than require()-ing it, so
  //    tracing never follows that edge. Without it: "libonnxruntime.so.1:
  //    cannot open shared object file".
  // 2. models/ (the local model files -- see embedding.ts's local_files_only)
  //    lives outside node_modules and isn't imported by path anywhere the
  //    tracer's static analysis can see, so it's dropped by default too.
  //
  // Scoped to only the routes that actually import that module, so every
  // other function's bundle stays small.
  outputFileTracingIncludes: {
    "/api/posts": ["./node_modules/onnxruntime-node/bin/napi-v6/linux/**", "./models/**"],
    "/api/posts/[id]": ["./node_modules/onnxruntime-node/bin/napi-v6/linux/**", "./models/**"],
    "/api/posts/[id]/matches/candidates": [
      "./node_modules/onnxruntime-node/bin/napi-v6/linux/**",
      "./models/**",
    ],
    "/api/diag-embed-test": [
      "./node_modules/onnxruntime-node/bin/napi-v6/linux/**",
      "./models/**",
    ],
  },
  images: {
    remotePatterns: [
      // Scoped to Vercel Blob's own domain suffix only -- not a blanket
      // `domains`/wildcard-everything allowance. Kept even after Phase 4's
      // move to Supabase Storage: any post created before that migration
      // still has a vercel-storage.com imageUrl in the DB, and this app
      // never bulk-rewrites old data on deploy.
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
      ...(supabasePattern ? [supabasePattern] : []),
    ],
  },
};

export default nextConfig;
