import { canAny } from "@/lib/permissions/check";
import type { PermissionHolder } from "@/lib/permissions/check";
import { prisma } from "@/lib/db/prisma";
import type { PostType } from "./schema";

// Who may see a post that is not public (security audit 2026-11-21, A-1).
// One rule for every read path, the same one GET /api/posts/[id] and the
// /post/[id] page apply:
//   - removed (withdrawn author / admin removal): admins with a post or
//     report permission only;
//   - temporarily hidden (rights-infringement report): its author and those
//     admins;
//   - otherwise public.
// Anything that reads data hanging off a post (its comments) must ask this
// first and answer "not found" when it says no.
const POST_ADMIN_PERMISSIONS = ["posts.manage", "posts.delete", "reports.view"] as const;

export type PostVisibilityRow = { authorId: number; tempHiddenAt: Date | null; removedAt: Date | null };

export function canViewPost(viewer: (PermissionHolder & { id: number }) | null | undefined, post: PostVisibilityRow): boolean {
  if (post.removedAt) return canAny(viewer, POST_ADMIN_PERMISSIONS);
  if (post.tempHiddenAt) return Boolean(viewer) && (viewer!.id === post.authorId || canAny(viewer, POST_ADMIN_PERMISSIONS));
  return true;
}

/** The visibility columns of one post, or null when it does not exist. */
export async function getPostVisibility(type: PostType, id: number): Promise<PostVisibilityRow | null> {
  const select = { userId: true, tempHiddenAt: true, removedAt: true } as const;
  const row = type === "lost"
    ? await prisma.lostPost.findUnique({ where: { id }, select })
    : await prisma.foundPost.findUnique({ where: { id }, select });
  return row ? { authorId: row.userId, tempHiddenAt: row.tempHiddenAt, removedAt: row.removedAt } : null;
}
