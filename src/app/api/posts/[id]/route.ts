import { NextRequest } from "next/server";

import {
  jsonError,
  jsonOk,
  postMutationResultToResponse,
  requireUserForApi,
  withErrorHandling,
} from "@/lib/posts/http";
import { postTypeSchema, updateFoundPostSchema, updateLostPostSchema } from "@/lib/posts/schema";
import {
  deleteFoundPost,
  deleteLostPost,
  getFoundPost,
  getLostPost,
  updateFoundPost,
  updateLostPost,
} from "@/lib/posts/service";

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

    if (parsedParams.type === "lost") {
      const parsed = updateLostPostSchema.safeParse(body);
      if (!parsed.success) {
        return jsonError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다.");
      }
      const result = await updateLostPost(parsedParams.id, auth.user.id, parsed.data);
      return postMutationResultToResponse(result);
    }

    const parsed = updateFoundPostSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다.");
    }
    const result = await updateFoundPost(parsedParams.id, auth.user.id, parsed.data);
    return postMutationResultToResponse(result);
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
        ? await deleteLostPost(parsed.id, auth.user.id)
        : await deleteFoundPost(parsed.id, auth.user.id);
    return postMutationResultToResponse(result);
  },
);
