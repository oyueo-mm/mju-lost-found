import type { User } from "@/generated/prisma/client";
import { isAdmin } from "@/lib/moderation/service";
import {
  deleteFoundPost,
  deleteLostPost,
  listFoundPosts,
  listLostPosts,
  type FoundPostDTO,
  type LostPostDTO,
  type PagedResult,
} from "@/lib/posts/service";
import type { PostType } from "@/lib/posts/schema";

// Phase 28-2: admin post management -- deliberately does NOT reimplement
// deletion or Storage cleanup. listLostPosts/listFoundPosts and
// deleteLostPost/deleteFoundPost (all from posts/service.ts) are the exact
// same functions every public list/delete path already uses; this module
// only adds the admin authorization wrapper around them (same
// belt-and-suspenders isAdmin() re-check every other admin/*.ts function
// in this app already does) and, for delete, passes `{ asAdmin: true }` to
// bypass the ownership check those functions already enforce for a normal
// user (see deleteLostPost's own comment on that option).

export type AdminPostMutationResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "forbidden" }
  | { kind: "not_found" };

// Mirrors admin/users.ts::listUsersForAdmin's own shape -- `type` picks
// which board's already-existing list function runs; `q`/`category` reuse
// buildSearchWhere's existing filters unchanged, `authorQuery` is the one
// new (purely additive) filter this phase adds to that shared where-builder.
export async function listPostsForAdmin(
  admin: User,
  {
    type,
    q,
    category,
    authorQuery,
    page,
    limit,
  }: { type: PostType; q?: string; category?: string; authorQuery?: string; page: number; limit: number },
): Promise<AdminPostMutationResult<PagedResult<LostPostDTO> | PagedResult<FoundPostDTO>>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  const params = { q, category, authorQuery, page, limit };
  const data = type === "lost" ? await listLostPosts(params) : await listFoundPosts(params);
  return { kind: "ok", data };
}

// Deletes any post regardless of who owns it -- the one thing this module
// adds on top of the reused deleteLostPost/deleteFoundPost, which by
// themselves only ever allow an owner to delete their own post. Cascade
// behavior (Comment/ChatRoom/Message) and Storage image cleanup are
// exactly what those functions already do; nothing about that is
// duplicated or altered here.
export async function deletePostForAdmin(
  admin: User,
  type: PostType,
  id: number,
): Promise<AdminPostMutationResult<{ id: number }>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  const result =
    type === "lost"
      ? await deleteLostPost(id, admin.id, { asAdmin: true })
      : await deleteFoundPost(id, admin.id, { asAdmin: true });

  // `forbidden` (not_owner) can never actually happen here -- asAdmin:
  // true bypasses that branch entirely in deleteLostPost/deleteFoundPost.
  // Narrowing it away keeps this function's own return type limited to
  // what an admin caller can actually receive.
  if (result.kind === "forbidden") return { kind: "not_found" };
  return result;
}
