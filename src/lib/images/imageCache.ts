import { dangerouslyDeleteBySrcImage } from "@vercel/functions";

// Vercel Image Optimization keeps transformed copies of a photo (one per
// width) for up to images.minimumCacheTTL (next.config.ts), keyed by the
// source URL -- they would outlive the photo itself. When a post photo is
// deleted from Storage, its cached transformations are deleted as well, so
// a removed photo is not served from /_next/image afterwards.
//
// - Runs inside the deployed function through Vercel's own request context
//   (@vercel/functions): no API token, nothing secret, nothing reaches the
//   browser. Only called from server code that already checked who may
//   delete the photo (the owner, an admin, the retention / orphan jobs).
// - "Delete", not "invalidate": an invalidated entry is served stale once
//   more while it revalidates; a deleted one goes back to the source, which
//   is gone.
// - Best effort: a failure (rate limit, outage) is logged without the URL
//   and never fails the deletion; the copies then expire with the TTL.
// - Outside Vercel (local runs, scripts, tests) there is no Vercel cache to
//   purge: nothing is done.
export type PurgeResult = "purged" | "skipped" | "failed";

export async function purgeOptimizedImages(srcUrls: string[], env: Record<string, string | undefined> = process.env): Promise<PurgeResult> {
  const urls = [...new Set(srcUrls.filter(Boolean))];
  if (urls.length === 0 || !env.VERCEL) return "skipped";
  try {
    // the same strings next/image is given as src (the stored public URL)
    await dangerouslyDeleteBySrcImage(urls, { revalidationDeadlineSeconds: 0 });
    return "purged";
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error ? String((error as { status: unknown }).status) : "unknown";
    console.error(`Image cache purge failed for ${urls.length} image(s) (status ${status}); they expire with the cache TTL`);
    return "failed";
  }
}
