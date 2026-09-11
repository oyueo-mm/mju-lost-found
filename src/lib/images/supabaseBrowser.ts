import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";

import { POST_IMAGES_BUCKET } from "./config";

// Phase N: the client singleton itself moved to src/lib/supabase/
// browserClient.ts (shared with the new chat Realtime hook) -- this file
// keeps its own upload-specific wrapper. Deliberately imports
// POST_IMAGES_BUCKET from the shared config.ts, not from supabaseAdmin.ts
// -- that module holds the service-role client and must never be pulled
// into a client bundle, even just for a constant.

// Uploads a file straight from the browser to Supabase Storage using a
// signed upload URL/token minted by our own server (POST /api/upload) --
// the file's bytes never pass through this Next.js server. Only usable
// once per token (Supabase-enforced), so a given (path, token) pair can't
// be replayed.
//
// 이미지 업로드 최적화 Phase: 파라미터 타입을 `File`에서 `Blob`으로
// 넓혔다 -- File은 이미 Blob이므로 기존 호출부(원본 File을 그대로
// 넘기던 채팅 이미지 업로드 등)는 전혀 영향받지 않고, 새로 추가된
// client.ts::optimizeImageForUpload()가 만들어내는 리사이즈/재인코딩된
// WebP Blob도 그대로 넘길 수 있다. `contentType`은 이제 인자로 받은
// blob 자신의 실제 타입(blob.type)을 쓴다 -- 최적화된 Blob의 진짜
// 타입(예: image/webp)과 호출부가 서버에 미리 알린 contentType이 항상
// 일치해야 하기 때문에, 호출부가 결정한 진실의 원천(blob.type)을 그대로
// 재사용할 뿐 새로 추론하지 않는다.
export async function uploadToSignedUrl(path: string, token: string, blob: Blob): Promise<void> {
  const { error } = await getSupabaseBrowserClient()
    .storage.from(POST_IMAGES_BUCKET)
    .uploadToSignedUrl(path, token, blob, { contentType: blob.type });
  if (error) throw error;
}
