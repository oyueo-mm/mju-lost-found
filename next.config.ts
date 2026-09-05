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
  //
  // Phase 13-2 note: /lost, /found, and /search now also reach this same
  // import path (searchPosts() -> searchPostsSemantic() ->
  // getEmbeddingProvider()) whenever mode=semantic. Adding any one of them
  // here was tried first (matching the pattern below) and confirmed
  // *working* locally, but a real Vercel deployment (this phase) hit a
  // separate, harder limit: the Hobby plan's 12-Serverless-Function cap
  // was already fully used by the three routes below -- adding even one
  // more route with its own outputFileTracingIncludes entry forces Vercel
  // to build it as an additional dedicated function (it can't merge with
  // the shared bundle once its included-files config differs), which
  // exceeds the cap regardless of which single route is added. The actual
  // fix (see src/app/(main)/lost/page.tsx, found/page.tsx, search/page.tsx)
  // is for those three pages to reach the embedding path via a
  // server-side fetch to /api/posts instead of importing it in-process, so
  // none of their own functions need these files at all.
  outputFileTracingIncludes: {
    "/api/posts": ["./node_modules/onnxruntime-node/bin/napi-v6/linux/**", "./models/**"],
    "/api/posts/[id]": ["./node_modules/onnxruntime-node/bin/napi-v6/linux/**", "./models/**"],
    "/api/posts/[id]/matches/candidates": [
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
