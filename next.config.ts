import type { NextConfig } from "next";

// Bug: Preview DB 복제 후 기존 게시글 이미지가 깨지는 문제 -- 이 hostname을
// `NEXT_PUBLIC_SUPABASE_URL`(현재 환경 자신의 Supabase project)에서만
// derive했더니, Production DB를 그대로 복제해 온 PostImage/LostPost/
// FoundPost.imageUrl 값(Production Supabase project의 절대 URL)이 Preview의
// remotePatterns에 없는 hostname이 되어 next/image가 전부 400
// (INVALID_IMAGE_OPTIMIZE_REQUEST)으로 거부했다 -- 파일 자체는 Production
// Storage에 정상 존재(직접 fetch 시 200), Preview 환경변수도 정상, 순수히
// 이 remotePattern이 "지금 이 환경 자신의 project"만 허용했던 게 원인.
//
// 바로 아래 Vercel Blob 패턴이 이미 세운 것과 같은 전례를 따른다: "이 앱은
// 배포 시 기존 데이터를 일괄 재작성하지 않는다"는 이유로 마이그레이션
// 이전(vercel-storage.com) hostname도 여전히 허용 목록에 남겨두는 것과
// 동일하게, Supabase project ref가 어떤 환경의 것이든(현재 환경 자신의
// 것이든, DB를 복제해 온 다른 환경의 것이든) 매치하도록 project ref
// 부분을 와일드카드로 둔다 -- pathname은 여전히 공개 버킷 객체 경로로만
// 제한되므로(자격증명이 필요한 경로는 매치되지 않음), 이 와일드카드가
// 넓히는 범위는 "어느 Supabase project의 공개 이미지냐"뿐이다.
const SUPABASE_STORAGE_PATTERN = {
  protocol: "https" as const,
  hostname: "*.supabase.co",
  pathname: "/storage/v1/object/public/**",
};

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
  // Phase 15-2 note: /api/posts/[id]/image (image attach/detach) was tried
  // as a new key here first -- confirmed via a real Vercel deployment to
  // push the Hobby plan's 12-Serverless-Function cap, the exact same class
  // of problem Phase 13-2 hit for text search. The fix here: that route
  // never computes an image embedding itself at all. Instead, it makes a
  // real internal HTTP request to PUT /api/posts/[id] (see that route's
  // own comment) -- which is not a new key, and whose function already
  // carries these same files below (the `./models/**` glob already covers
  // Xenova/siglip-base-patch16-224 too, since it's fetched into the same
  // models/ directory -- see scripts/downloadModel.mjs). No new
  // Serverless Function was needed for image search at all.
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
      SUPABASE_STORAGE_PATTERN,
    ],
  },
};

export default nextConfig;
