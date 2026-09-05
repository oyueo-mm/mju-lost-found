import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { POST_IMAGES_BUCKET } from "./config";

// Client-safe: NEXT_PUBLIC_SUPABASE_ANON_KEY is designed by Supabase to be
// public (same category as a Firebase web config or Vercel Blob's public
// store id) -- it authorizes nothing on its own for this bucket's writes,
// since every upload here is additionally gated by a short-lived,
// server-minted signed token (see src/app/api/upload/route.ts). Deliberately
// imports POST_IMAGES_BUCKET from the shared config.ts, not from
// supabaseAdmin.ts -- that module holds the service-role client and must
// never be pulled into a client bundle, even just for a constant.
let _browserClient: SupabaseClient | null = null;
function getSupabaseBrowserClient(): SupabaseClient {
  if (_browserClient) return _browserClient;
  _browserClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  );
  return _browserClient;
}

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
