import { runImageJob } from "@/lib/ai/imageJob";
import { rateLimitFailure, rateLimitFailureResponse } from "@/lib/rateLimit";
export const maxDuration = 120;
import { managePost } from "@/lib/posts/management";
import { NextRequest } from "next/server";

import {
  jsonError,
  jsonOk,
  postMutationResultToResponse,
  requireUserForApi,
  withErrorHandling,
} from "@/lib/posts/http";
import { postTypeSchema, updateFoundPostSchema, updateLostPostSchema } from "@/lib/posts/schema";
import { deleteFoundPost, deleteLostPost, getFoundPost, getLostPost } from "@/lib/posts/service";
import { updateFoundPost, updateLostPost } from "@/lib/posts/aiService";

import { findPostRecommendations } from "@/lib/recommendation/service";
import { getCurrentUser } from "@/lib/auth/session";
import { canAny } from "@/lib/permissions/check";
import { isCurrentlySuspended } from "@/lib/auth/suspension";
import { SUSPENDED_ACCOUNT_MESSAGE } from "@/lib/posts/response";

// PATCH conditionally triggers embedPostBestEffort() -- real ONNX Runtime
// inference (@huggingface/transformers, a native addon) that cannot run on
// the Edge runtime. Pinned for the whole file for simplicity even though
// GET/DELETE don't need it.
export const runtime = "nodejs";

// LostPost and FoundPost each have their own autoincrement id sequence
// (separate tables, see schema.prisma) -- the same id can legitimately
// exist in both, so `type` is a required query param on every operation
// here, never inferred or guessed.
function parseParams(idParam: string, searchParams: URLSearchParams) {
  const id = Number(idParam);
  const typeResult = postTypeSchema.safeParse(searchParams.get("type"));
  if (!Number.isInteger(id) || !typeResult.success) return null;
  return { id, type: typeResult.data };
}

export const GET = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id: idParam } = await params;
    const parsed = parseParams(idParam, request.nextUrl.searchParams);
    if (!parsed) {
      return jsonError(400, "id와 type('lost' 또는 'found')이 올바르지 않습니다.");
    }

    const post =
      parsed.type === "lost" ? await getLostPost(parsed.id) : await getFoundPost(parsed.id);
    if (!post) return jsonError(404, "게시물을 찾을 수 없습니다.");

    // Legal pre-beta Phase: a temporarily hidden post is only for its
    // author and admins -- anyone else gets the same 404 as a missing post.
    // 회원탈퇴: a withdrawn author's leftover post is for admins only.
    if (post.removedAt) {
      const viewer = await getCurrentUser();
      if (!canAny(viewer, ["posts.manage", "posts.delete", "reports.view"])) return jsonError(404, "게시물을 찾을 수 없습니다.");
    }
    if (post.tempHiddenAt) {
      const viewer = await getCurrentUser();
      if (!viewer || (viewer.id !== post.author.id && !canAny(viewer, ["posts.manage", "posts.delete", "reports.view"]))) {
        return jsonError(404, "게시물을 찾을 수 없습니다.");
      }
    }

    // Phase 11-2: piggybacks on this existing route instead of adding a
    // new one -- this file's PATCH handler already imports aiService.ts
    // (updateLostPost/updateFoundPost), so its function bundle already
    // carries the AI dependency chain findPostRecommendations() itself
    // doesn't need but this route's neighbors do; adding this here costs
    // nothing extra on Vercel's Hobby 12-function cap. Only computed when
    // asked for (post/[id]/page.tsx's own server render still calls
    // findPostRecommendations() directly, not through this route) -- used
    // by PendingRecommendations.tsx to poll for a freshly-created post's
    // recommendations once its embedding (deferred via after(), see
    // aiService.ts's createLostPost/createFoundPost) finishes computing.
    // Best-effort: a failure here degrades to "recommendations omitted",
    // never a failed post fetch.
    if (request.nextUrl.searchParams.get("include") === "recommendations") {
      try {
        const recommendations = await findPostRecommendations(parsed.type, parsed.id);
        return jsonOk({ ...post, recommendations });
      } catch (error) {
        console.error("Failed to load recommendations for GET /api/posts/[id]:", error);
        return jsonOk({ ...post, recommendations: [] });
      }
    }
    return jsonOk(post);
  },
);

export const PATCH = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await requireUserForApi();
    if ("response" in auth) return auth.response;

    const { id: idParam } = await params;
    const parsedParams = parseParams(idParam, request.nextUrl.searchParams);
    if (!parsedParams) {
      return jsonError(400, "id와 type('lost' 또는 'found')이 올바르지 않습니다.");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "잘못된 요청 본문입니다.");
    }

    if (body && typeof body === "object" && "management" in body) {
      if (Object.keys(body).length !== 1) return jsonError(400, "관리 작업에는 다른 수정 항목을 함께 보낼 수 없습니다.");
      const result = await managePost(auth.user.id, parsedParams.type, parsedParams.id, (body as { management: unknown }).management);
      return "error" in result ? jsonError(result.status, result.error!) : jsonOk(result);
    }

    if (parsedParams.type === "lost") {
      const parsed = updateLostPostSchema.safeParse(body);
      if (!parsed.success) {
        return jsonError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다.");
      }
      const result = await updateLostPost(parsedParams.id, auth.user, parsed.data);
      return postMutationResultToResponse(result);
    }

    const parsed = updateFoundPostSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다.");
    }
    const result = await updateFoundPost(parsedParams.id, auth.user, parsed.data);
    return postMutationResultToResponse(result);
  },
);

// Owner-requested recompute of the DB's current image through the shared job
// controller. Image attachment calls the same controller directly in after();
// no origin/Host-derived HTTP callback or forwarded cookie remains.
export const PUT = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await requireUserForApi();
    if ("response" in auth) return auth.response;

    // Release C (M-1): a suspended author can't trigger re-embedding.
    if (isCurrentlySuspended(auth.user)) return jsonError(403, SUSPENDED_ACCOUNT_MESSAGE);

    const { id: idParam } = await params;
    const parsedParams = parseParams(idParam, request.nextUrl.searchParams);
    if (!parsedParams) {
      return jsonError(400, "id와 type('lost' 또는 'found')이 올바르지 않습니다.");
    }

    const post =
      parsedParams.type === "lost" ? await getLostPost(parsedParams.id) : await getFoundPost(parsedParams.id);
    if (!post) return jsonError(404, "게시물을 찾을 수 없습니다.");
    if (post.author.id !== auth.user.id) return jsonError(403, "본인 게시물만 수정할 수 있습니다.");

    if (!post.imageUrl) return jsonOk({ embedded: false, jobStatus: "no_image" });
    const result = await runImageJob(parsedParams.type, parsedParams.id, true);
    if (result.status === "limited") return rateLimitFailureResponse(rateLimitFailure(result.admission)!);
    if (result.status === "failed") return jsonError(503, "이미지 분석을 잠시 처리할 수 없습니다. 다시 시도해주세요.");
    return jsonOk({ embedded: result.status === "completed" || result.status === "reused", jobStatus: result.status });
  },
);

export const DELETE = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await requireUserForApi();
    if ("response" in auth) return auth.response;

    const { id: idParam } = await params;
    const parsed = parseParams(idParam, request.nextUrl.searchParams);
    if (!parsed) {
      return jsonError(400, "id와 type('lost' 또는 'found')이 올바르지 않습니다.");
    }

    const result =
      parsed.type === "lost"
        ? await deleteLostPost(parsed.id, auth.user)
        : await deleteFoundPost(parsed.id, auth.user);
    return postMutationResultToResponse(result);
  },
);
