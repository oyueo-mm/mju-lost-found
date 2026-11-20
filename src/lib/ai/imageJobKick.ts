// Function Storage C-1: the photo route must not carry the image model.
//
// Attaching/replacing/reordering a photo changes the post's image_url, and the
// database trigger (migration 20261122000000_image_embedding_jobs) already
// queues the durable ImageEmbeddingJob for it. This module only asks the
// function that HAS the models (/api/posts, mode=embedding-maintenance, the
// same entry the daily cron uses) to drain the queue now. It imports nothing
// from the embedding chain, so the photo route's trace stays model-free.
//
// Failure is safe: the job stays pending in the database and is picked up by
// the /api/posts request-time recovery (recoverImageJobsAfterRequest) or the
// daily cron. Duplicate work is prevented by the job's hash/lease protocol.

export function imageJobDrainUrl(fallbackOrigin: string, env: NodeJS.ProcessEnv = process.env): string {
  // VERCEL_URL is this very deployment, so a Preview never drains through
  // Production (or the other way round).
  const origin = env.VERCEL_URL ? `https://${env.VERCEL_URL}` : fallbackOrigin;
  return `${origin}/api/posts?mode=embedding-maintenance`;
}

export async function kickImageJobs(fallbackOrigin: string, env: NodeJS.ProcessEnv = process.env): Promise<"sent" | "skipped" | "failed"> {
  const secret = env.CRON_SECRET;
  if (!secret) return "skipped";
  const headers: Record<string, string> = { authorization: `Bearer ${secret}` };
  // Preview deployments are behind Deployment Protection; Vercel's own
  // automation bypass lets a deployment call itself (no user credential).
  if (env.VERCEL_AUTOMATION_BYPASS_SECRET) headers["x-vercel-protection-bypass"] = env.VERCEL_AUTOMATION_BYPASS_SECRET;
  try {
    const response = await fetch(imageJobDrainUrl(fallbackOrigin, env), { headers, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(55_000) });
    await response.body?.cancel();
    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
