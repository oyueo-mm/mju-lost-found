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
import { embedPostImageBestEffort } from "@/lib/ai/postEmbedding";

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

// Phase 15-2, internal-only: recomputes this post's image embedding from
// its *current* imageUrl (never a client-supplied one -- there is no
// request body at all). Not a public feature in its own right; exists so
// POST /api/posts/[id]/image can trigger image-embedding computation via
// an internal request to *this* route, which already carries the ONNX
// runtime + model files in its Vercel function bundle (see this file's
// `runtime = "nodejs"` above and next.config.ts's outputFileTracingIncludes)
// -- the image-attach route's own bundle deliberately does not, since
// giving it that same tracing entry was confirmed (via a real Vercel
// deployment) to push the Hobby plan's 12-Serverless-Function cap. Same
// auth/ownership gate as PATCH/DELETE above; a caller who isn't signed in
// or doesn't own the post can't trigger this for someone else's post, and
// a post with no image simply has nothing to embed.
export const PUT = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await requireUserForApi();
    if ("response" in auth) return auth.response;

    const { id: idParam } = await params;
    const parsedParams = parseParams(idParam, request.nextUrl.searchParams);
    if (!parsedParams) {
      return jsonError(400, "id와 type('lost' 또는 'found')이 올바르지 않습니다.");
    }

    const post =
      parsedParams.type === "lost" ? await getLostPost(parsedParams.id) : await getFoundPost(parsedParams.id);
    if (!post) return jsonError(404, "게시물을 찾을 수 없습니다.");
    if (post.author.id !== auth.user.id) return jsonError(403, "본인 게시물만 수정할 수 있습니다.");

    if (post.imageUrl) {
      await embedPostImageBestEffort(parsedParams.type, parsedParams.id, post.imageUrl);
    }
    return jsonOk({ embedded: Boolean(post.imageUrl) });
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
