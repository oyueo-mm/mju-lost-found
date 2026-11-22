import { prisma } from "@/lib/db/prisma";
import type { RateLimitTier } from "@/lib/rateLimit";

import { CHAT_IMAGES_BUCKET, POST_IMAGES_BUCKET } from "./config";
import { removeChatImage } from "./chatStorage";
import { isValidImagePathname, parseChatImagePathname, parseImagePathname } from "./pathname";
import { deletePostImagePaths, publicUrlFor } from "./supabaseAdmin";

// Security audit A-3 (2026-11-22): uploads that are never attached.
//
// A signed upload URL lets the browser put up to 10 MB straight into
// Storage; the app only learns of the file when it is attached to a post or
// a chat message. Before this, nothing bounded or removed files that never
// were, so one account could fill the project's Storage. Now every URL the
// app mints is recorded (UploadIntent) and:
//   - a member may hold at most OPEN_UPLOAD_CAP not-yet-attached uploads
//     from the last 24 hours (staff more, they register in batches);
//   - attaching marks the upload attached;
//   - the daily maintenance cron removes uploads still open after
//     SWEEP_AFTER_HOURS, after re-checking that no row references them.
// The per-window rate limit (RATE_LIMITS.imageUpload) still applies too.

export type UploadBucket = typeof POST_IMAGES_BUCKET | typeof CHAT_IMAGES_BUCKET;

export const OPEN_UPLOAD_CAP: Record<RateLimitTier, number> = { user: 40, staff: 300 };
export const OPEN_UPLOAD_WINDOW_HOURS = 24;
// The signed URL is valid ~2 hours; a form left open for a day is the
// longest legitimate gap between upload and attach.
export const SWEEP_AFTER_HOURS = 24;
export const SWEEP_BATCH = 200;

const HOUR_MS = 3600 * 1000;

/** True while the member is under the cap of open (unattached) uploads. */
export async function canOpenUpload(userId: number, tier: RateLimitTier, now = new Date()): Promise<boolean> {
  const open = await prisma.uploadIntent.count({
    where: { userId, attachedAt: null, deletedAt: null, createdAt: { gt: new Date(now.getTime() - OPEN_UPLOAD_WINDOW_HOURS * HOUR_MS) } },
  });
  return open < OPEN_UPLOAD_CAP[tier];
}

/** Records a minted upload URL. Called before the URL is handed out. */
export async function recordUploadIntent(userId: number, bucket: UploadBucket, path: string): Promise<void> {
  await prisma.uploadIntent.create({ data: { userId, bucket, path } });
}

/** Marks uploads as attached. Never fails the attach that already succeeded. */
export async function markUploadsAttached(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await prisma.uploadIntent.updateMany({ where: { path: { in: paths }, attachedAt: null }, data: { attachedAt: new Date() } });
  } catch (error) {
    // The sweep re-checks references before deleting, so a missed mark
    // never loses a photo -- it is only resolved a day later.
    console.error("Upload intent attach mark failed:", error instanceof Error ? error.name : "unknown");
  }
}

async function isReferenced(bucket: string, path: string): Promise<boolean> {
  if (bucket === CHAT_IMAGES_BUCKET) {
    return (await prisma.message.count({ where: { imagePath: path } })) > 0;
  }
  const url = publicUrlFor(path);
  const [lost, found, gallery, legacyMessage] = await Promise.all([
    prisma.lostPost.count({ where: { imageUrl: url } }),
    prisma.foundPost.count({ where: { imageUrl: url } }),
    prisma.postImage.count({ where: { imageUrl: url } }),
    // Chat messages once stored full post-images URLs (Message.imagePath).
    prisma.message.count({ where: { imagePath: url } }),
  ]);
  return lost + found + gallery + legacyMessage > 0;
}

export type UploadSweepMode = "dry-run" | "delete";
/**
 * Deleting is opt-in: unless UPLOAD_SWEEP_MODE=delete is set on the
 * deployment, the daily run only REPORTS what it would remove (2026-11-22:
 * the first Production runs are reviewed before anything is deleted).
 */
export function sweepModeFromEnv(env: Record<string, string | undefined> = process.env): UploadSweepMode {
  return env.UPLOAD_SWEEP_MODE === "delete" ? "delete" : "dry-run";
}
// More deletable files than this in one run is not normal for this service:
// the run deletes nothing and says why.
export const SWEEP_MAX_DELETES_PER_RUN = 100;

export type UploadSweepResult = {
  mode: UploadSweepMode;
  examined: number; deleted: number; wouldDelete: number; referenced: number; failed: number; skipped: number;
  ownershipMismatch: number; halted: null | "ownership_mismatch" | "too_many_candidates";
};

/** post-images: the path's post must belong to whoever minted the upload (or be gone). */
async function postOwnershipHolds(path: string, userId: number): Promise<boolean> {
  const parsed = parseImagePathname(path);
  if (!parsed) return false;
  const post = parsed.postType === "lost"
    ? await prisma.lostPost.findUnique({ where: { id: parsed.postId }, select: { userId: true } })
    : await prisma.foundPost.findUnique({ where: { id: parsed.postId }, select: { userId: true } });
  return !post || post.userId === userId;
}

/**
 * Removes uploads still open SWEEP_AFTER_HOURS after their URL was minted.
 * Safety, in order:
 *   - only paths in the app's own naming scheme are considered;
 *   - a file some row references is kept (and, in delete mode, marked attached);
 *   - post-images: the post in the path must belong to the uploader (or be
 *     gone) -- a mismatch should never happen, so ANY mismatch halts the
 *     whole run before a single deletion;
 *   - more than SWEEP_MAX_DELETES_PER_RUN deletable files halts the run too;
 *   - dry-run (the default) writes nothing at all: no Storage call, no row.
 * Chat images: the uploader's membership of the room was checked when the URL
 * was minted (server side); here the path must still name a room id.
 */
export async function sweepUnattachedUploads(now = new Date(), batch = SWEEP_BATCH, mode: UploadSweepMode = sweepModeFromEnv()): Promise<UploadSweepResult> {
  const result: UploadSweepResult = { mode, examined: 0, deleted: 0, wouldDelete: 0, referenced: 0, failed: 0, skipped: 0, ownershipMismatch: 0, halted: null };
  const due = await prisma.uploadIntent.findMany({
    where: { attachedAt: null, deletedAt: null, createdAt: { lt: new Date(now.getTime() - SWEEP_AFTER_HOURS * HOUR_MS) } },
    orderBy: { createdAt: "asc" },
    take: batch,
    select: { path: true, bucket: true, userId: true },
  });
  // Pass 1 (read-only): classify every candidate.
  const deletable: { path: string; bucket: string }[] = [];
  const referenced: string[] = [];
  for (const intent of due) {
    result.examined++;
    const ownName = intent.bucket === CHAT_IMAGES_BUCKET ? Boolean(parseChatImagePathname(intent.path)) : isValidImagePathname(intent.path);
    if (!ownName) {
      result.skipped++;
      continue;
    }
    try {
      if (await isReferenced(intent.bucket, intent.path)) {
        referenced.push(intent.path);
        continue;
      }
      if (intent.bucket !== CHAT_IMAGES_BUCKET && !(await postOwnershipHolds(intent.path, intent.userId))) {
        result.ownershipMismatch++;
        continue;
      }
      deletable.push(intent);
    } catch (error) {
      result.failed++;
      console.error("Unattached upload sweep check failed for one file:", error instanceof Error ? error.name : "unknown");
    }
  }
  result.referenced = referenced.length;
  result.wouldDelete = deletable.length;
  if (result.ownershipMismatch > 0) result.halted = "ownership_mismatch";
  else if (deletable.length > SWEEP_MAX_DELETES_PER_RUN) result.halted = "too_many_candidates";
  if (mode !== "delete" || result.halted) return result;

  // Pass 2 (delete mode, nothing suspicious): act.
  for (const path of referenced) {
    try {
      await prisma.uploadIntent.update({ where: { path }, data: { attachedAt: new Date() } });
    } catch {
      // only a bookkeeping mark: the next run re-checks the reference anyway
    }
  }
  for (const intent of deletable) {
    try {
      const removed = intent.bucket === CHAT_IMAGES_BUCKET ? await removeChatImage(intent.path) : await deletePostImagePaths([intent.path]);
      if (!removed) {
        result.failed++;
        continue;
      }
      await prisma.uploadIntent.update({ where: { path: intent.path }, data: { deletedAt: new Date() } });
      result.deleted++;
    } catch (error) {
      result.failed++;
      console.error("Unattached upload sweep failed for one file:", error instanceof Error ? error.name : "unknown");
    }
  }
  return result;
}
