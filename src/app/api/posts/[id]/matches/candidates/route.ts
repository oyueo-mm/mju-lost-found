import { NextRequest } from "next/server";

import { jsonError, jsonOk, requireUserForApi, withErrorHandling } from "@/lib/posts/http";
import { postTypeSchema } from "@/lib/posts/schema";
import { findMatchCandidates } from "@/lib/match/candidates";

// GET /api/posts/[id]/matches/candidates?type=lost|found
//
// `type` here means the *source* post's board (the one at [id]) -- the
// response lists candidates from the opposite board. Requires auth and
// ownership of the source post (see findMatchCandidates), same as every
// other authorization rule in the match domain: this never bypasses it
// just because it's AI-flavored.
export const GET = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await requireUserForApi();
    if ("response" in auth) return auth.response;

    const { id: idParam } = await params;
    const id = Number(idParam);
    const typeResult = postTypeSchema.safeParse(request.nextUrl.searchParams.get("type"));
    if (!Number.isInteger(id) || !typeResult.success) {
      return jsonError(400, "id와 type('lost' 또는 'found')이 올바르지 않습니다.");
    }

    const result = await findMatchCandidates(typeResult.data, id, auth.user.id);
    switch (result.kind) {
      case "ok":
        return jsonOk(result.data);
      case "not_found":
        return jsonError(404, "게시물을 찾을 수 없습니다.");
      case "forbidden":
        return jsonError(403, "본인 게시물의 매칭 후보만 조회할 수 있습니다.");
      case "ai_unavailable":
        return jsonError(503, "AI 매칭 후보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
    }
  },
);
