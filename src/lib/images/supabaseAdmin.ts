import { getSupabaseAdminClient as getAdminClient } from "@/lib/supabase/adminClient";

import { POST_IMAGES_BUCKET } from "./config";

// Server-only -- see src/lib/supabase/adminClient.ts (where the service-
// role client singleton itself now lives, shared with the new chat
// Realtime broadcaster) for why this must never be imported from a "use
// client" file. This file keeps its own Storage-specific wrappers.

// Mints a one-time, path-scoped upload credential (valid ~2 hours per
// Supabase's own default) -- the actual file bytes never pass through this
// server (see src/app/api/upload/route.ts for why: Vercel's Serverless
// Function body-size limit is well under this app's 10MB image cap). The
// caller (that route) is responsible for verifying login/suspension/
// ownership *before* calling this -- this function itself has no
// authorization logic of its own, it only talks to Supabase.
export async function createSignedUploadUrl(
  pathname: string,
): Promise<{ path: string; token: string }> {
  const { data, error } = await getAdminClient()
    .storage.from(POST_IMAGES_BUCKET)
    .createSignedUploadUrl(pathname);
  if (error || !data) {
    throw new Error(`Failed to create signed upload URL: ${error?.message ?? "unknown error"}`);
  }
  return { path: data.path, token: data.token };
}

// Pure URL construction, no network call -- safe to call unconditionally.
// The post-images bucket is public (see docs/VERCEL_MIGRATION_ANALYSIS.md /
// the Phase 4 report for why: every post is already visible to any
// logged-in member, so a signed/expiring read URL would only add
// expiry-refresh complexity for zero actual confidentiality benefit).
export function publicUrlFor(pathname: string): string {
  return getAdminClient().storage.from(POST_IMAGES_BUCKET).getPublicUrl(pathname).data.publicUrl;
}

// The exact inverse of publicUrlFor() -- used to recover the storage path
// from the URL string stored in LostPost/FoundPost.imageUrl, since that
// column stores the ready-to-display public URL (matching the legacy
// schema's image_url semantics), not the raw path. Returns null if the URL
// doesn't actually look like one of ours (defensive; should never happen
// for a URL this app itself wrote).
export function pathnameFromPublicUrl(url: string): string | null {
  const prefix = `${publicUrlFor("")}`; // ".../object/public/post-images/" (encodeURI on an empty path is still just the prefix)
  if (!url.startsWith(prefix)) return null;
  return decodeURIComponent(url.slice(prefix.length));
}

// Best-effort cleanup -- failures are logged, never thrown, so a Storage
// hiccup never blocks a post mutation (delete/replace) that already
// succeeded in the DB. Mirrors the legacy Vercel Blob module's
// deleteBlobSafely() (same name kept in spirit, not literally, since this
// takes the stored public URL and resolves it to a path itself).
export async function deleteObjectSafely(publicUrl: string): Promise<void> {
  const path = pathnameFromPublicUrl(publicUrl);
  if (!path) {
    console.error("Failed to delete storage object: URL is not a recognized post-images URL", publicUrl);
    return;
  }
  try {
    const { error } = await getAdminClient().storage.from(POST_IMAGES_BUCKET).remove([path]);
    if (error) throw error;
  } catch (error) {
    console.error("Failed to delete storage object:", path, error);
  }
}
