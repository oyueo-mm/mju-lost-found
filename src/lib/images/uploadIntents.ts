import { prisma } from "@/lib/db/prisma";
import type { RateLimitTier } from "@/lib/rateLimit";

import { CHAT_IMAGES_BUCKET, POST_IMAGES_BUCKET } from "./config";
import { removeChatImage } from "./chatStorage";
import { isValidImagePathname, parseChatImagePathname } from "./pathname";
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

export type UploadSweepResult = { examined: number; deleted: number; referenced: number; failed: number; skipped: number };

/**
 * Removes uploads still open SWEEP_AFTER_HOURS after their URL was minted.
 * Bounded per run; a file some row references is marked attached instead.
 * Only paths in the app's own naming scheme are ever deleted.
 */
export async function sweepUnattachedUploads(now = new Date(), batch = SWEEP_BATCH): Promise<UploadSweepResult> {
  const result: UploadSweepResult = { examined: 0, deleted: 0, referenced: 0, failed: 0, skipped: 0 };
  const due = await prisma.uploadIntent.findMany({
    where: { attachedAt: null, deletedAt: null, createdAt: { lt: new Date(now.getTime() - SWEEP_AFTER_HOURS * HOUR_MS) } },
    orderBy: { createdAt: "asc" },
    take: batch,
    select: { path: true, bucket: true },
  });
  for (const intent of due) {
    result.examined++;
    const ownName = intent.bucket === CHAT_IMAGES_BUCKET ? Boolean(parseChatImagePathname(intent.path)) : isValidImagePathname(intent.path);
    if (!ownName) {
      result.skipped++;
      continue;
    }
    try {
      if (await isReferenced(intent.bucket, intent.path)) {
        await prisma.uploadIntent.update({ where: { path: intent.path }, data: { attachedAt: new Date() } });
        result.referenced++;
        continue;
      }
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
