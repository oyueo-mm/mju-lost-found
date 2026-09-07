import { NextRequest } from "next/server";

import { jsonError, requireAdminForApi, withErrorHandling } from "@/lib/moderation/http";
import { adminUserMutationResultToResponse } from "@/lib/admin/response";
import { updateUserByAdminSchema } from "@/lib/admin/schema";
import { updateUserByAdmin } from "@/lib/admin/users";

// PATCH /api/admin/users/[id] { action: "promote"|"demote"|"suspend"|"unsuspend", suspendDurationDays? }
// One endpoint dispatches to whichever of the four toggles the admin
// picked -- same "single endpoint, discriminated body" shape
// api/admin/reports/[id]/process/route.ts already uses, kept for the same
// reason (small API surface) and, this phase, to avoid adding an extra
// Vercel Serverless Function for what both PATCH/DELETE-only reasonably do
// via a query/body dispatch.
export const PATCH = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await requireAdminForApi();
    if ("response" in auth) return auth.response;

    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id)) return jsonError(400, "id가 올바르지 않습니다.");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "잘못된 요청 본문입니다.");
    }
    const parsed = updateUserByAdminSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다.");
    }

    const result = await updateUserByAdmin(
      auth.user,
      id,
      parsed.data.action,
      parsed.data.suspendDurationDays,
      parsed.data.reasonCategory,
      parsed.data.reason,
    );
    return adminUserMutationResultToResponse(result);
  },
);
