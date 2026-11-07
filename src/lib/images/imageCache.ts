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
// - @vercel/functions resolves without doing anything when the function's
//   request context has no purge API, so that is checked first and treated
//   as a failure -- never reported as purged.
// - Best effort, never fails the deletion: a transient failure (rate limit,
//   outage) is retried a few times. If it still fails, or the purge API is
//   missing, the copies would stay up to the TTL, so the error names the
//   photo URLs for an operator to purge by hand (docs/operations.md). They
//   are the URLs of photos just deleted, logged only to the project's own
//   function logs.
// - A purge that went through is logged as requested (a count, no URL):
//   the API accepting it is all the function can know.
// - Outside Vercel (local runs, scripts, tests) there is no Vercel cache to
//   purge: nothing is done.
export type PurgeResult = "purged" | "skipped" | "failed" | "unavailable";

export const PURGE_ATTEMPTS = 3;
const PURGE_RETRY_BASE_MS = 300;

// The context @vercel/functions itself reads (its get-context.js).
const REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

export function hasImagePurgeApi(): boolean {
  const context = (globalThis as { [REQUEST_CONTEXT]?: { get?: () => { purge?: { dangerouslyDeleteBySrcImage?: unknown } } | undefined } })[REQUEST_CONTEXT]?.get?.();
  return typeof context?.purge?.dangerouslyDeleteBySrcImage === "function";
}

const purgeByHand = (urls: string[]) => `cached copies stay until the cache TTL unless purged by hand: ${urls.join(" ")}`;

export async function purgeOptimizedImages(
  srcUrls: string[],
  env: Record<string, string | undefined> = process.env,
  {
    attempts = PURGE_ATTEMPTS,
    baseDelayMs = PURGE_RETRY_BASE_MS,
    hasPurgeApi = hasImagePurgeApi,
  }: { attempts?: number; baseDelayMs?: number; hasPurgeApi?: () => boolean } = {},
): Promise<PurgeResult> {
  const urls = [...new Set(srcUrls.filter(Boolean))];
  if (urls.length === 0 || !env.VERCEL) return "skipped";
  if (!hasPurgeApi()) {
    console.error(`Image cache purge unavailable in this function for ${urls.length} image(s); ${purgeByHand(urls)}`);
    return "unavailable";
  }
  for (let attempt = 1; ; attempt++) {
    try {
      // the same strings next/image is given as src (the stored public URL)
      await dangerouslyDeleteBySrcImage(urls, { revalidationDeadlineSeconds: 0 });
      console.info(`Image cache purge requested for ${urls.length} image(s)`);
      return "purged";
    } catch (error) {
      if (attempt >= attempts) {
        const status = typeof error === "object" && error !== null && "status" in error ? String((error as { status: unknown }).status) : "unknown";
        console.error(`Image cache purge failed for ${urls.length} image(s) after ${attempts} attempts (status ${status}); ${purgeByHand(urls)}`);
        return "failed";
      }
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)));
    }
  }
}
