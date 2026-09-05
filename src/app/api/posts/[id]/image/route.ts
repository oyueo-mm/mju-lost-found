import { NextRequest } from "next/server";

import { jsonError, jsonOk, requireUserForApi, withErrorHandling } from "@/lib/posts/http";
import { postTypeSchema } from "@/lib/posts/schema";
import { attachImageSchema } from "@/lib/images/schema";
import { clearPostImage, setPostImage, type ImageMutationResult } from "@/lib/images/service";

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
  }
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

    const result = await setPostImage(parsedParams.type, parsedParams.id, auth.user.id, parsed.data);

    // Phase 15-2: this route's own Vercel function bundle deliberately
    // carries no ONNX runtime/model files (see next.config.ts's comment --
    // adding them here was confirmed via a real deployment to exceed the
    // Hobby plan's 12-Serverless-Function cap), so image-embedding
    // computation is triggered via a real internal HTTP request to PUT
    // /api/posts/[id] instead, which already has those files for its own
    // (text) embedding work. Forwarding the incoming cookie header
    // authenticates the internal call as the same user -- requireUserForApi()
    // there re-checks ownership regardless. Best-effort: a failure here is
    // logged but never turns an already-successful image attach into a
    // failed response.
    if (result.kind === "ok") {
      try {
        const embedUrl = `${request.nextUrl.origin}/api/posts/${parsedParams.id}?type=${parsedParams.type}`;
        const embedRes = await fetch(embedUrl, {
          method: "PUT",
          headers: { cookie: request.headers.get("cookie") ?? "" },
        });
        if (!embedRes.ok) {
          console.error(
            `Image embedding trigger responded with ${embedRes.status} for ${parsedParams.type} post ${parsedParams.id}`,
          );
        }
      } catch (error) {
        console.error(
          `Failed to trigger image embedding for ${parsedParams.type} post ${parsedParams.id}:`,
          error,
        );
      }
    }

    return imageResultToResponse(result);
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

    const result = await clearPostImage(parsed.type, parsed.id, auth.user.id);
    return imageResultToResponse(result);
  },
);
