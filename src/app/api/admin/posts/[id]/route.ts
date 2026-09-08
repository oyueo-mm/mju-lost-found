import { NextRequest } from "next/server";

import { jsonError, requireAdminForApi, withErrorHandling } from "@/lib/moderation/http";
import { adminPostMutationResultToResponse } from "@/lib/admin/response";
import { deletePostForAdmin } from "@/lib/admin/posts";
import { postTypeSchema } from "@/lib/posts/schema";

// DELETE /api/admin/posts/[id]?type=lost|found -- admin-only, deletes any
// post regardless of who owns it. Reuses deleteLostPost/deleteFoundPost
// (posts/service.ts) via deletePostForAdmin's `{ asAdmin: true }` -- same
// DB delete, same cascade (Comment/ChatRoom/Message), same Storage
// image cleanup those functions already do for a normal owner-initiated
// delete; nothing about that is reimplemented here.
export const DELETE = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await requireAdminForApi();
    if ("response" in auth) return auth.response;

    const { id: idParam } = await params;
    const id = Number(idParam);
    const typeResult = postTypeSchema.safeParse(request.nextUrl.searchParams.get("type"));
    if (!Number.isInteger(id) || !typeResult.success) {
      return jsonError(400, "id와 type('lost' 또는 'found')이 올바르지 않습니다.");
    }

    const result = await deletePostForAdmin(auth.user, typeResult.data, id);
    return adminPostMutationResultToResponse(result);
  },
);
