import { NextRequest, after } from "next/server";

import { jsonError, jsonOk, requireUserForApi, withErrorHandling } from "@/lib/posts/http";
import { postTypeSchema } from "@/lib/posts/schema";
import { attachImageSchema, reorderImagesSchema } from "@/lib/images/schema";
import { MAX_IMAGES_PER_POST } from "@/lib/images/config";
import {
  attachPostImages,
  clearPostImage,
  deletePostImage,
  reorderPostImages,
  setPostImage,
  type ImageMutationResult,
} from "@/lib/images/service";

// Phase 11-4 Integration: individual-image-delete and reorder were
// originally their own route files (.../images/[imageId]/route.ts and
// .../images/route.ts, Phase 11-4C/11-4D) -- a real Preview deploy of that
// shape hit the Hobby plan's 12-Serverless-Function cap (confirmed via
// deployment 5VvtgC43adQ6di9rncBPhiPaT9G5: "No more than 12 Serverless
// Functions can be added..."), the same class of problem this file's own
// POST handler already worked around once before (Phase 15-2's `paths`
// union instead of a second endpoint). Both were folded back into this one
// file via query-string discriminators instead -- `imageId` on DELETE picks
// individual-image delete over whole-post clear, and PATCH (a method this
// path never used before) is reorder -- exactly the "discriminated-body/
// query API reuse pattern" this codebase already uses elsewhere (e.g.
// GET /api/posts/[id]'s own `?include=recommendations`). Net effect: two
// fewer Serverless Functions than the three-file version, zero fewer
// features.
function parseParams(idParam: string, searchParams: URLSearchParams) {
  const id = Number(idParam);
  const typeResult = postTypeSchema.safeParse(searchParams.get("type"));
  if (!Number.isInteger(id) || !typeResult.success) return null;
  return { id, type: typeResult.data };
}

function imageResultToResponse<T>(result: ImageMutationResult<T>) {
  switch (result.kind) {
    case "ok":
      return jsonOk(result.data);
    case "not_found":
      return jsonError(404, "게시물을 찾을 수 없습니다.");
    case "forbidden":
      return jsonError(403, "본인 게시물만 수정할 수 있습니다.");
    case "invalid_path":
      return jsonError(400, "업로드 결과를 확인할 수 없습니다.");
    case "too_many_images":
      return jsonError(400, `게시글에는 최대 ${MAX_IMAGES_PER_POST}장의 이미지만 등록할 수 있습니다.`);
    case "invalid_order":
      return jsonError(400, "이미지 순서가 게시글의 현재 이미지 목록과 일치하지 않습니다.");
  }
}

// Shared by POST/DELETE(imageId)/PATCH below -- any of the three can
// change which image is primary, so all three need this post's
// image-embedding recomputed the same deferred way. See the POST handler's
// own (original, Phase 15-2/H-5-2) comment for the full ONNX-bundle-size
// reasoning; unchanged by this phase's route-count fix.
function triggerEmbeddingRecompute(request: NextRequest, id: number, type: string) {
  after(async () => {
    try {
      const embedUrl = `${request.nextUrl.origin}/api/posts/${id}?type=${type}`;
      const embedRes = await fetch(embedUrl, {
        method: "PUT",
        headers: { cookie: request.headers.get("cookie") ?? "" },
      });
      if (!embedRes.ok) {
        console.error(`Image embedding trigger responded with ${embedRes.status} for ${type} post ${id}`);
      }
    } catch (error) {
      console.error(`Failed to trigger image embedding for ${type} post ${id}:`, error);
    }
  });
}

// Attaches (or replaces) a post's image with one that has already
// finished uploading directly to Supabase Storage -- see
// src/lib/images/service.ts::setPostImage for the "new URL saved before
// the old object is deleted" ordering that keeps a failed replace from
// losing the previous image.
export const POST = withErrorHandling(
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

    const parsed = attachImageSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다.");
    }

    // Phase 11-4C: "paths" (plural, new) attaches one or more additional
    // gallery images via attachPostImages(); the legacy "path" (singular)
    // shape -- PostForm.tsx's only actual request today -- keeps going
    // through setPostImage()'s unchanged single-image replace behavior.
    // See src/lib/images/schema.ts's attachImageSchema for why these are
    // two branches of one union rather than two separate request bodies.
    const result: ImageMutationResult<{ imageUrl: string | null }> =
      "paths" in parsed.data
        ? await attachPostImages(parsedParams.type, parsedParams.id, auth.user.id, parsed.data)
        : await setPostImage(parsedParams.type, parsedParams.id, auth.user.id, parsed.data);

    if (result.kind === "ok") triggerEmbeddingRecompute(request, parsedParams.id, parsedParams.type);

    return imageResultToResponse(result);
  },
);

// Phase 11-4 Integration: `?imageId=` picks deletePostImage() (one image
// out of the gallery, Phase 11-4C) over clearPostImage() (every image the
// post has, PostForm.tsx's original single-image "remove" -- still the
// default with no `imageId`). See this file's own top-of-file comment for
// why this became a query param instead of its own route file.
export const DELETE = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await requireUserForApi();
    if ("response" in auth) return auth.response;

    const { id: idParam } = await params;
    const parsed = parseParams(idParam, request.nextUrl.searchParams);
    if (!parsed) {
      return jsonError(400, "id와 type('lost' 또는 'found')이 올바르지 않습니다.");
    }

    const imageIdParam = request.nextUrl.searchParams.get("imageId");
    if (imageIdParam !== null) {
      const imageId = Number(imageIdParam);
      if (!Number.isInteger(imageId)) {
        return jsonError(400, "imageId가 올바르지 않습니다.");
      }
      const result = await deletePostImage(parsed.type, parsed.id, auth.user.id, imageId);
      if (result.kind === "ok") triggerEmbeddingRecompute(request, parsed.id, parsed.type);
      return imageResultToResponse(result);
    }

    const result = await clearPostImage(parsed.type, parsed.id, auth.user.id);
    return imageResultToResponse(result);
  },
);

// Phase 11-4 Integration: reassigns displayOrder/primary for a post's
// entire current set of PostImage rows in one call (originally its own
// PATCH /api/posts/[id]/images route, Phase 11-4D) -- see
// src/lib/images/service.ts::reorderPostImages for the actual logic and
// this file's own top comment for why it moved here.
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

    const parsed = reorderImagesSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다.");
    }

    const result = await reorderPostImages(parsedParams.type, parsedParams.id, auth.user.id, parsed.data.imageIds);
    if (result.kind === "ok") triggerEmbeddingRecompute(request, parsedParams.id, parsedParams.type);

    return imageResultToResponse(result);
  },
);
