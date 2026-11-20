import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { PostType } from "@/lib/posts/schema";

// Queue-side helpers for the image job, free of any model import, so routes
// that only enqueue (Function Storage C-1/C-2) never pull inference code.
export const IMAGE_JOB_MODEL = "image-v1:4649052661e53c7000355844105f8a1792088239:";
export const imageInputHash = (url: string) => createHash("sha256").update(IMAGE_JOB_MODEL + url).digest("hex");
const table = (type: PostType) => type === "lost" ? Prisma.sql`"LostPost"` : Prisma.sql`"FoundPost"`;

// Owner-requested recompute (PUT /api/posts/[id]) without inference: make sure
// the durable job exists for the DB's current photo and, like runImageJob's
// manual path, re-arm a failed or abandoned one. The model-carrying worker
// then runs it under the usual lease, cooldown and automatic budget.
export async function requeueImageJob(type: PostType, id: number): Promise<"no_image" | "reused" | "pending"> {
  const current = (await prisma.$queryRaw<{ image_url: string | null; has_vector: boolean }[]>(Prisma.sql`SELECT image_url,("imageEmbedding" IS NOT NULL) AS has_vector FROM ${table(type)} WHERE id=${id}`))[0];
  if (!current?.image_url) return "no_image";
  const hash = imageInputHash(current.image_url);
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "ImageEmbeddingJob"(post_type,post_id,owner_id,desired_hash) SELECT ${type},p.id,p.user_id,${hash} FROM ${table(type)} p WHERE p.id=${id} AND p.image_url=${current.image_url} FOR KEY SHARE ON CONFLICT(post_type,post_id) DO NOTHING`);
  const job = (await prisma.$queryRaw<{ completed_hash: string | null; state: string }[]>`SELECT completed_hash,state FROM "ImageEmbeddingJob" WHERE post_type=${type} AND post_id=${id}`)[0];
  if (job?.completed_hash === hash && job.state === "completed" && current.has_vector) return "reused";
  await prisma.$executeRaw`UPDATE "ImageEmbeddingJob" SET attempts=0,state='pending' WHERE post_type=${type} AND post_id=${id} AND state IN ('failed','running') AND next_run_at <= (now() AT TIME ZONE 'UTC') AND (lease_until IS NULL OR lease_until < (now() AT TIME ZONE 'UTC'))`;
  return "pending";
}
