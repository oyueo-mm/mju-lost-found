import { dangerouslyDeleteBySrcImage } from "@vercel/functions";

// Vercel Image Optimization keeps transformed copies of a photo (one per
// width) for up to images.minimumCacheTTL (next.config.ts, 31 days), keyed
// by the source URL -- they would outlive the photo itself. When a post
// photo is deleted from Storage, its cached transformations are deleted as
// well, so a removed photo is not served from /_next/image afterwards.
//
// - Runs inside the deployed function through Vercel's own request context
//   (@vercel/functions): no API token, nothing secret, nothing reaches the
//   browser. Only called from server code that already checked who may
//   delete the photo (the owner, an admin, the retention / orphan jobs).
// - "Delete", not "invalidate": an invalidated entry is served stale once
//   more while it revalidates; a deleted one goes back to the source, which
//   is gone.
// - Best effort, never fails the deletion: a transient failure (rate limit,
//   outage) is retried a few times. If it still fails, the copies would stay
//   up to the TTL, so the error names the photo URLs for an operator to
//   purge by hand (`vercel cache dangerously-delete --srcimg <url>`, see
//   docs/operations.md). They are the URLs of photos just deleted, logged
//   only to the project's own function logs.
// - Outside Vercel (local runs, scripts, tests) there is no Vercel cache to
//   purge: nothing is done.
export type PurgeResult = "purged" | "skipped" | "failed";

export const PURGE_ATTEMPTS = 3;
const PURGE_RETRY_BASE_MS = 300;

export async function purgeOptimizedImages(
  srcUrls: string[],
  env: Record<string, string | undefined> = process.env,
  { attempts = PURGE_ATTEMPTS, baseDelayMs = PURGE_RETRY_BASE_MS }: { attempts?: number; baseDelayMs?: number } = {},
): Promise<PurgeResult> {
  const urls = [...new Set(srcUrls.filter(Boolean))];
  if (urls.length === 0 || !env.VERCEL) return "skipped";
  for (let attempt = 1; ; attempt++) {
    try {
      // the same strings next/image is given as src (the stored public URL)
      await dangerouslyDeleteBySrcImage(urls, { revalidationDeadlineSeconds: 0 });
      return "purged";
    } catch (error) {
      if (attempt >= attempts) {
        const status = typeof error === "object" && error !== null && "status" in error ? String((error as { status: unknown }).status) : "unknown";
        console.error(
          `Image cache purge failed for ${urls.length} image(s) after ${attempts} attempts (status ${status}); ` +
            `cached copies stay until the cache TTL unless purged by hand: ${urls.join(" ")}`,
        );
        return "failed";
      }
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)));
    }
  }
}
