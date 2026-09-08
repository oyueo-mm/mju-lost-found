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
export async function uploadToSignedUrl(path: string, token: string, file: File): Promise<void> {
  const { error } = await getSupabaseBrowserClient()
    .storage.from(POST_IMAGES_BUCKET)
    .uploadToSignedUrl(path, token, file, { contentType: file.type });
  if (error) throw error;
}
