import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { PostType } from "@/lib/posts/schema";
import { isCurrentlySuspended } from "@/lib/auth/suspension";
import { checkRateLimit, rateLimitTierFor, type RateLimitResult } from "@/lib/rateLimit";
import { getImageEmbeddingProvider, IMAGE_EMBEDDING_DIMENSIONS } from "./imageEmbedding";
import { invalidateRecommendationCache } from "@/lib/recommendation/service";

import { imageInputHash } from "./imageJobQueue";
export { IMAGE_JOB_MODEL, imageInputHash } from "./imageJobQueue";
type Job = { post_type: PostType; post_id: number; owner_id: number; desired_hash: string | null; completed_hash: string | null; generation: number; lease_token: string | null; lease_valid?: boolean; attempts: number; state: string };
export type ImageJobResult = { status: "completed" | "reused" | "in_progress" | "pending" | "no_image" | "stale" | "failed" } | { status: "limited"; admission: Exclude<RateLimitResult, { ok: true }> };
const table = (type: PostType) => type === "lost" ? Prisma.sql`"LostPost"` : Prisma.sql`"FoundPost"`;

async function source(type: PostType, id: number) {
  const row = (await prisma.$queryRaw<{ image_url: string | null; user_id: number; has_vector: boolean; worker_ready: boolean }[]>(Prisma.sql`SELECT image_url,user_id,("imageEmbedding" IS NOT NULL) AS has_vector,(SELECT enabled AND resume_at <= (clock_timestamp() AT TIME ZONE 'UTC') FROM "ImageEmbeddingRuntime" WHERE id=true) AS worker_ready FROM ${table(type)} WHERE id=${id}`))[0];
  return row;
}

// Used by owner PUT and after() alike; ownership is also rechecked against
// the durable job's source, never a cookie or URL forwarded over HTTP.
export async function runImageJob(type: PostType, id: number, manual = false): Promise<ImageJobResult> {
  const token = `image-v2:${randomUUID()}`;
  let acquired = false;
  let job: Job | undefined;
  try {
    const current = await source(type, id);
    if (!current?.image_url) return { status: "no_image" };
    if (!current.worker_ready) return { status: "pending" };
    const hash = imageInputHash(current.image_url);
    // Lock the existing parent for the legacy/manual enqueue path too: a
    // concurrent delete must run its cleanup trigger AFTER this insert.
    await prisma.$executeRaw(Prisma.sql`INSERT INTO "ImageEmbeddingJob"(post_type,post_id,owner_id,desired_hash) SELECT ${type},p.id,p.user_id,${hash} FROM ${table(type)} p WHERE p.id=${id} AND p.image_url=${current.image_url} FOR KEY SHARE ON CONFLICT(post_type,post_id) DO NOTHING`);
    const old = (await prisma.$queryRaw<Job[]>`SELECT * FROM "ImageEmbeddingJob" WHERE post_type=${type} AND post_id=${id}`)[0];
    if (old?.completed_hash === hash && old.state === "completed" && current.has_vector) return { status: "reused" };
    // An explicitly requested retry still observes persisted cooldowns and
    // all budgets. Automatic retries stop after five failed attempts.
    if (manual) await prisma.$executeRaw`UPDATE "ImageEmbeddingJob" SET attempts=0,state='pending' WHERE post_type=${type} AND post_id=${id} AND state IN ('failed','running') AND next_run_at <= (now() AT TIME ZONE 'UTC') AND (lease_until IS NULL OR lease_until < (now() AT TIME ZONE 'UTC'))`;
    job = (await prisma.$queryRaw<Job[]>`UPDATE "ImageEmbeddingJob" SET lease_token=${token},lease_until=(now() AT TIME ZONE 'UTC')+interval '150 seconds',attempts=attempts+1,state='running',updated_at=(now() AT TIME ZONE 'UTC') WHERE post_type=${type} AND post_id=${id} AND desired_hash=${hash} AND state IN ('pending','running','failed') AND attempts<5 AND next_run_at <= (now() AT TIME ZONE 'UTC') AND (lease_until IS NULL OR lease_until < (now() AT TIME ZONE 'UTC')) AND EXISTS(SELECT 1 FROM "ImageEmbeddingRuntime" WHERE id=true AND enabled AND resume_at <= (clock_timestamp() AT TIME ZONE 'UTC')) RETURNING *`)[0];
    if (!job) return { status: "in_progress" };
    acquired = true;
    const owner = await prisma.user.findUnique({ where: { id: job.owner_id } });
    if (!owner || owner.deletedAt || owner.withdrawnAt || isCurrentlySuspended(owner)) throw new Error("OwnerUnavailable");
    const tier = await rateLimitTierFor(owner);
    for (const [action, subject] of [[manual ? "embeddingRecompute" : "embeddingAutomatic", { userId: owner.id, tier }], [type === "lost" ? "embeddingLostPost" : "embeddingFoundPost", { userId: id }]] as const) {
      const admission = await checkRateLimit(action, subject);
      if (!admission.ok) {
        await prisma.$executeRaw`UPDATE "ImageEmbeddingJob" SET lease_token=NULL,lease_until=NULL,state='pending',attempts=CASE WHEN generation=${job.generation} THEN GREATEST(0,attempts-1) ELSE attempts END,next_run_at=CASE WHEN generation=${job.generation} THEN (now() AT TIME ZONE 'UTC')+${admission.retryAfterSeconds}*interval '1 second' ELSE next_run_at END WHERE post_type=${type} AND post_id=${id} AND lease_token=${token}`;
        acquired = false;
        return { status: "limited", admission };
      }
    }
    const vector = await getImageEmbeddingProvider().embed(current.image_url);
    if (vector.length !== IMAGE_EMBEDDING_DIMENSIONS || vector.some(n => !Number.isFinite(n))) throw new Error("InvalidEmbedding");
    const committed = await prisma.$transaction(async tx => {
      // Consistent lock order with the source trigger: post first, job second.
      const rows = await tx.$queryRaw<{ image_url: string | null }[]>(Prisma.sql`SELECT image_url FROM ${table(type)} WHERE id=${id} FOR UPDATE`);
      const jobs = await tx.$queryRaw<Job[]>`SELECT *, (lease_until > (clock_timestamp() AT TIME ZONE 'UTC')) AS lease_valid FROM "ImageEmbeddingJob" WHERE post_type=${type} AND post_id=${id} FOR UPDATE`;
      const active = jobs[0];
      if (rows[0]?.image_url !== current.image_url || active?.lease_token !== token || !active.lease_valid || active.generation !== job!.generation || active.desired_hash !== hash) return false;
      // Transaction-local settings cannot leak through a pooled connection.
      // The database trigger also fences old deployments without this protocol.
      await tx.$executeRaw`SELECT set_config('mju.image_job_token',${token},true),set_config('mju.image_job_generation',${String(job!.generation)},true)`;
      await tx.$executeRaw(Prisma.sql`UPDATE ${table(type)} SET "imageEmbedding"=${`[${vector.join(",")}]`}::vector WHERE id=${id}`);
      await invalidateRecommendationCache(type, id, tx);
      await tx.$executeRaw`UPDATE "ImageEmbeddingJob" SET completed_hash=${hash},state='completed',lease_token=NULL,lease_until=NULL,last_error=NULL,updated_at=(now() AT TIME ZONE 'UTC') WHERE post_type=${type} AND post_id=${id} AND lease_token=${token}`;
      return true;
    });
    if (!committed) return { status: "stale" };
    acquired = false;
    return { status: "completed" };
  } catch (error) {
    if (acquired) {
      // Generation changes belong to a newer input; do not back off that job.
      await prisma.$executeRaw`UPDATE "ImageEmbeddingJob" SET lease_token=NULL,lease_until=NULL,state=CASE WHEN generation=${job!.generation} THEN 'failed' ELSE state END,last_error=${error instanceof Error ? error.name : "Error"},next_run_at=CASE WHEN generation=${job!.generation} THEN (now() AT TIME ZONE 'UTC')+interval '10 seconds' ELSE next_run_at END WHERE post_type=${type} AND post_id=${id} AND lease_token=${token}`.catch(() => {});
    }
    console.error("Image embedding job failed:", error instanceof Error ? error.name : "Error");
    return { status: "failed" };
  } finally {
    if (acquired) await prisma.$executeRaw`UPDATE "ImageEmbeddingJob" SET lease_token=NULL,lease_until=NULL,state=CASE WHEN state='running' THEN 'pending' ELSE state END WHERE post_type=${type} AND post_id=${id} AND lease_token=${token}`.catch(() => {});
  }
}

export async function drainImageJobs(limit = 4): Promise<void> {
  const rows = await prisma.$queryRaw<{ post_type: PostType; post_id: number }[]>`SELECT post_type,post_id FROM "ImageEmbeddingJob" WHERE desired_hash IS NOT NULL AND state IN ('pending','running','failed') AND attempts<5 AND next_run_at <= (now() AT TIME ZONE 'UTC') AND (lease_until IS NULL OR lease_until < (now() AT TIME ZONE 'UTC')) AND EXISTS(SELECT 1 FROM "ImageEmbeddingRuntime" WHERE id=true AND enabled AND resume_at <= (clock_timestamp() AT TIME ZONE 'UTC')) ORDER BY next_run_at LIMIT ${Math.min(limit, 8)}`;
  for (const row of rows) await runImageJob(row.post_type, row.post_id);
}

let nextRecoveryAt = 0;
let recovery: Promise<void> | undefined;
// At most one recovery read per 15 seconds per warm instance, including when
// the queue is empty. Explicit cron/manual drains bypass this local throttle;
// cross-instance execution remains protected by the durable database lease.
export function recoverImageJobsAfterRequest(): Promise<void> {
  if (recovery) return recovery;
  if (Date.now() < nextRecoveryAt) return Promise.resolve();
  nextRecoveryAt = Date.now() + 15000;
  recovery = drainImageJobs(1).finally(() => { recovery = undefined; });
  return recovery;
}

export async function runLatestImageJob(type: PostType, id: number): Promise<void> {
  // Coalesce changes during inference without an unbounded after() loop.
  for (let i = 0; i < 3; i++) {
    const result = await runImageJob(type, id);
    if (result.status !== "stale") break;
  }
}
