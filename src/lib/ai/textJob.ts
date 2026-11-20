import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { PostType } from "@/lib/posts/schema";
import { buildEmbeddingText, EMBEDDING_DIMENSIONS, getEmbeddingProvider, type EmbeddableFields } from "./embedding";
import { invalidateRecommendationCache } from "@/lib/recommendation/service";

// Function Storage C-2: post text re-embedding after an edit. The DB trigger
// (migration 20261124000000_text_embedding_jobs) queues a job, bumping its
// generation, in the same transaction as a real change of the four fields
// buildEmbeddingText() reads. Only the model-carrying /api/posts function runs
// this (embedding-maintenance drain + request-time recovery), so
// /api/posts/[id] ships no model.
//
// Consistency: the worker claims one generation with a lease, embeds the
// post's text as stored at that moment, and commits only while it still
// holds a valid lease on that same generation (post row locked first, then
// the job, the trigger's own order). An edit committed meanwhile bumps the
// generation, so the late result is dropped and the newer generation runs
// next; the previous vector stays in place until a current one replaces it.
export const TEXT_JOB_TOKEN_PREFIX = "text-v1:";
const LEASE_SECONDS = 150;
const MAX_ATTEMPTS = 5;
type ClaimedJob = { generation: number };
type ActiveJob = { generation: number; lease_token: string | null; lease_valid: boolean | null };
type Source = EmbeddableFields;
export type TextJobResult = { status: "completed" | "in_progress" | "stale" | "missing" | "failed" };
const table = (type: PostType) => type === "lost" ? Prisma.sql`"LostPost"` : Prisma.sql`"FoundPost"`;
const sameText = (a: Source, b: Source) => buildEmbeddingText(a) === buildEmbeddingText(b);

export async function runTextJob(type: PostType, id: number): Promise<TextJobResult> {
  const token = `${TEXT_JOB_TOKEN_PREFIX}${randomUUID()}`;
  let job: ClaimedJob | undefined;
  try {
    job = (await prisma.$queryRaw<ClaimedJob[]>`UPDATE "TextEmbeddingJob" SET lease_token=${token},lease_until=(now() AT TIME ZONE 'UTC')+${LEASE_SECONDS}*interval '1 second',attempts=attempts+1,state='running',updated_at=(now() AT TIME ZONE 'UTC') WHERE post_type=${type} AND post_id=${id} AND state IN ('pending','running','failed') AND attempts<${MAX_ATTEMPTS} AND next_run_at <= (now() AT TIME ZONE 'UTC') AND (lease_until IS NULL OR lease_until < (now() AT TIME ZONE 'UTC')) RETURNING generation`)[0];
    if (!job) return { status: "in_progress" };
    const source = (await prisma.$queryRaw<Source[]>(Prisma.sql`SELECT title,description,category,location FROM ${table(type)} WHERE id=${id}`))[0];
    if (!source) return { status: "missing" }; // deleted: its cleanup trigger removes the job
    const vector = await getEmbeddingProvider().embed(buildEmbeddingText(source));
    if (vector.length !== EMBEDDING_DIMENSIONS || vector.some((n) => !Number.isFinite(n))) throw new Error("InvalidEmbedding");
    const committed = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Source[]>(Prisma.sql`SELECT title,description,category,location FROM ${table(type)} WHERE id=${id} FOR UPDATE`);
      const active = (await tx.$queryRaw<ActiveJob[]>`SELECT generation,lease_token,(lease_until > (clock_timestamp() AT TIME ZONE 'UTC')) AS lease_valid FROM "TextEmbeddingJob" WHERE post_type=${type} AND post_id=${id} FOR UPDATE`)[0];
      if (!rows[0] || !sameText(rows[0], source) || active?.lease_token !== token || !active.lease_valid || active.generation !== job!.generation) return false;
      await tx.$executeRaw(Prisma.sql`UPDATE ${table(type)} SET embedding=${`[${vector.join(",")}]`}::vector WHERE id=${id}`);
      await invalidateRecommendationCache(type, id, tx);
      await tx.$executeRaw`UPDATE "TextEmbeddingJob" SET state='completed',completed_generation=generation,lease_token=NULL,lease_until=NULL,last_error=NULL,updated_at=(now() AT TIME ZONE 'UTC') WHERE post_type=${type} AND post_id=${id} AND lease_token=${token}`;
      return true;
    });
    return { status: committed ? "completed" : "stale" };
  } catch (error) {
    if (job) {
      // A newer generation is already pending: do not back it off.
      await prisma.$executeRaw`UPDATE "TextEmbeddingJob" SET lease_token=NULL,lease_until=NULL,state=CASE WHEN generation=${job.generation} THEN 'failed' ELSE state END,last_error=${error instanceof Error ? error.name : "Error"},next_run_at=CASE WHEN generation=${job.generation} THEN (now() AT TIME ZONE 'UTC')+interval '10 seconds' ELSE next_run_at END,updated_at=(now() AT TIME ZONE 'UTC') WHERE post_type=${type} AND post_id=${id} AND lease_token=${token}`.catch(() => {});
    }
    console.error("Text embedding job failed:", error instanceof Error ? error.name : "Error");
    return { status: "failed" };
  } finally {
    // Stale or missing claims give the lease back; a completed or failed job no longer carries this token.
    if (job) await prisma.$executeRaw`UPDATE "TextEmbeddingJob" SET lease_token=NULL,lease_until=NULL,state=CASE WHEN state='running' THEN 'pending' ELSE state END WHERE post_type=${type} AND post_id=${id} AND lease_token=${token}`.catch(() => {});
  }
}

export async function drainTextJobs(limit = 4): Promise<void> {
  const rows = await prisma.$queryRaw<{ post_type: PostType; post_id: number }[]>`SELECT post_type,post_id FROM "TextEmbeddingJob" WHERE state IN ('pending','running','failed') AND attempts<${MAX_ATTEMPTS} AND next_run_at <= (now() AT TIME ZONE 'UTC') AND (lease_until IS NULL OR lease_until < (now() AT TIME ZONE 'UTC')) ORDER BY next_run_at LIMIT ${Math.min(limit, 8)}`;
  for (const row of rows) await runTextJob(row.post_type, row.post_id);
}

let nextRecoveryAt = 0;
let recovery: Promise<void> | undefined;
// Same throttle as the image recovery: at most one read per 15 seconds per
// warm instance; cross-instance safety comes from the durable lease.
export function recoverTextJobsAfterRequest(): Promise<void> {
  if (recovery) return recovery;
  if (Date.now() < nextRecoveryAt) return Promise.resolve();
  nextRecoveryAt = Date.now() + 15000;
  recovery = drainTextJobs(1).finally(() => { recovery = undefined; });
  return recovery;
}
