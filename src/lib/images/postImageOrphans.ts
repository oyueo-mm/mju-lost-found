import { prisma } from "@/lib/db/prisma";
import { getSupabaseAdminClient } from "@/lib/supabase/adminClient";

import { POST_IMAGES_BUCKET } from "./config";
import { deletePostImagePaths, pathnameFromPublicUrl } from "./supabaseAdmin";

// 개인정보 감사: post-images is a public bucket, so a file left behind by a
// failed delete (deleteObjectSafely gives up after its retries) or by an
// upload that was never attached to a post stays reachable by URL. This
// finds such files -- objects no LostPost/FoundPost.imageUrl or
// PostImage.imageUrl points at -- and, only when asked, removes them.
//
// Never run automatically: scripts/sweepPostImageOrphans.ts is the only
// caller, dry-run by default. Objects younger than minAgeHours are left
// alone, since an upload is stored before it's attached to its post (the
// signed upload URL alone is valid ~2 hours), and objects whose creation
// time Storage didn't report are never treated as orphans.

export const DEFAULT_ORPHAN_MIN_AGE_HOURS = 24;

export type StoredObject = { path: string; createdAt: Date | null; size: number | null };

export type OrphanSelection = {
  orphans: StoredObject[];
  recentUnreferenced: StoredObject[];
  unknownAgeUnreferenced: StoredObject[];
};

// Pure: which stored objects count as orphans.
export function selectPostImageOrphans(
  objects: StoredObject[],
  referencedPaths: Set<string>,
  now: Date,
  minAgeHours: number = DEFAULT_ORPHAN_MIN_AGE_HOURS,
): OrphanSelection {
  const cutoff = now.getTime() - minAgeHours * 3600 * 1000;
  const selection: OrphanSelection = { orphans: [], recentUnreferenced: [], unknownAgeUnreferenced: [] };
  for (const object of objects) {
    if (referencedPaths.has(object.path)) continue;
    if (object.createdAt === null) selection.unknownAgeUnreferenced.push(object);
    else if (object.createdAt.getTime() < cutoff) selection.orphans.push(object);
    else selection.recentUnreferenced.push(object);
  }
  return selection;
}

export async function listPostImageObjects(): Promise<StoredObject[]> {
  const bucket = getSupabaseAdminClient().storage.from(POST_IMAGES_BUCKET);
  const objects: StoredObject[] = [];
  async function walk(prefix: string) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await bucket.list(prefix, { limit: 1000, offset });
      if (error) throw new Error(`list ${prefix || "/"} failed: ${error.message}`);
      for (const entry of data ?? []) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        // Folders come back without an id.
        if (entry.id) {
          objects.push({ path, createdAt: entry.created_at ? new Date(entry.created_at) : null, size: entry.metadata?.size ?? null });
        } else {
          await walk(path);
        }
      }
      if ((data ?? []).length < 1000) break;
    }
  }
  await walk("");
  return objects;
}

// Every post-images path a row still points at. A URL from another
// Supabase project (e.g. Production URLs in a Preview DB copy) resolves to
// null and is simply not one of this bucket's paths.
export async function referencedPostImagePaths(): Promise<Set<string>> {
  const [images, lost, found] = await Promise.all([
    prisma.postImage.findMany({ select: { imageUrl: true } }),
    prisma.lostPost.findMany({ where: { imageUrl: { not: null } }, select: { imageUrl: true } }),
    prisma.foundPost.findMany({ where: { imageUrl: { not: null } }, select: { imageUrl: true } }),
  ]);
  const paths = new Set<string>();
  for (const { imageUrl } of [...images, ...lost, ...found]) {
    const path = imageUrl ? pathnameFromPublicUrl(imageUrl) : null;
    if (path) paths.add(path);
  }
  return paths;
}

export type SweepResult = OrphanSelection & { objects: number; referenced: number; deleted: number; failed: number };

export async function sweepPostImageOrphans({
  apply,
  minAgeHours = DEFAULT_ORPHAN_MIN_AGE_HOURS,
  now = new Date(),
}: {
  apply: boolean;
  minAgeHours?: number;
  now?: Date;
}): Promise<SweepResult> {
  // References are read after the listing, so a row written while the
  // bucket is being listed still protects its file.
  const objects = await listPostImageObjects();
  const referenced = await referencedPostImagePaths();
  const selection = selectPostImageOrphans(objects, referenced, now, minAgeHours);
  let deleted = 0;
  let failed = 0;
  if (apply) {
    for (let i = 0; i < selection.orphans.length; i += 100) {
      const batch = selection.orphans.slice(i, i + 100).map((o) => o.path);
      if (await deletePostImagePaths(batch)) deleted += batch.length;
      else failed += batch.length;
    }
  }
  return { ...selection, objects: objects.length, referenced: referenced.size, deleted, failed };
}
