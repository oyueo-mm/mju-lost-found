import { NextRequest, NextResponse } from "next/server";

import {
  jsonError,
  postMutationResultToResponse,
  requireUserForApi,
  withErrorHandling,
} from "@/lib/posts/http";
import {
  createFoundPostSchema,
  createLostPostSchema,
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  MAX_LIMIT,
  MAX_SEARCH_QUERY_LENGTH,
  listQuerySchema,
  postListTypeSchema,
  postTypeSchema,
} from "@/lib/posts/schema";
import { createFoundPost, createLostPost, searchPosts, searchPostsAI, searchPostsByImage } from "@/lib/posts/aiService";
import { ALLOWED_IMAGE_CONTENT_TYPES, MAX_IMAGE_SIZE_BYTES, isAllowedImageContentType } from "@/lib/images/config";

// POST creates a post, which triggers embedPostBestEffort() -- real
// ONNX Runtime inference (@huggingface/transformers, a native addon) that
// cannot run on the Edge runtime. Pinned for the whole file for simplicity
// even though GET itself doesn't need it.
export const runtime = "nodejs";

export const GET = withErrorHandling(async (request: NextRequest) => {
  const query = listQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) {
    return jsonError(400, query.error.issues[0]?.message ?? "잘못된 검색 조건입니다.");
  }

  const result = await searchPosts(query.data);

  return NextResponse.json({
    data: result.items,
    pagination: {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: result.totalPages,
    },
  });
});

// Phase 32: image search's request/response shape mirrors GET's own
// listQuerySchema-driven query exactly (type=lost|found, page, limit,
// same `{ data, pagination }` envelope) -- the only real difference is
// the query *value* itself (an uploaded photo, which a GET request has no
// clean way to carry), so this stays a POST branch of this same route
// file rather than a new one. No new Serverless Function: this file's
// function bundle already carries the image-embedding model (via
// aiService.ts -> imageEmbedding.ts), the same one /api/posts/[id]/
// similar-images.func and /api/posts/[id]/image.func also bundle -- see
// this project's own Hobby-plan 12-function-cap history.
function parsePageParam(value: string | null): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_PAGE;
}
function parseLimitParam(value: string | null): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

async function handleImageSearch(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const typeResult = postTypeSchema.safeParse(searchParams.get("type"));
  if (!typeResult.success) {
    return jsonError(400, "이미지 검색은 게시판(분실물 또는 습득물)을 선택한 경우에만 사용할 수 있습니다.");
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError(400, "잘못된 요청 본문입니다. 이미지를 다시 선택해주세요.");
  }

  const image = formData.get("image");
  if (!(image instanceof File) || image.size === 0) {
    return jsonError(400, "검색할 이미지를 선택해주세요.");
  }
  if (!isAllowedImageContentType(image.type)) {
    return jsonError(400, `${ALLOWED_IMAGE_CONTENT_TYPES.join(", ")} 형식의 이미지만 업로드할 수 있습니다.`);
  }
  if (image.size > MAX_IMAGE_SIZE_BYTES) {
    return jsonError(400, "이미지 용량은 10MB를 넘을 수 없습니다.");
  }

  const page = parsePageParam(searchParams.get("page"));
  const limit = parseLimitParam(searchParams.get("limit"));

  let result;
  try {
    result = await searchPostsByImage(typeResult.data, image, { page, limit });
  } catch (error) {
    console.error("Image search failed:", error);
    return jsonError(502, "이미지를 분석하지 못했습니다. 다른 이미지로 다시 시도해주세요.");
  }

  return NextResponse.json({
    data: result.items,
    pagination: {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: result.totalPages,
    },
  });
}

// AI 검색 고도화 Phase: "AI 검색" -- 텍스트 선택, 이미지 선택, 둘 중 하나
// 이상 필요. 이미지가 FormData로 와야 해서(GET 쿼리스트링에 담을 수 없음)
// handleImageSearch와 같은 이유로 이 라우트의 POST 분기로 남는다. 기존
// mode=image 분기는 그대로 두고(다른 곳에서 참조하지 않지만, 되돌릴 필요가
// 없는 한 굳이 지우지 않는다) 새 mode=ai 분기를 추가하는 방식 -- 새 API
// route를 만들지 않고 이 파일이 이미 갖고 있는 POST 진입점을 그대로 쓴다.
async function handleAiSearch(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const typeResult = postListTypeSchema.safeParse(searchParams.get("type"));
  if (!typeResult.success) {
    return jsonError(400, "게시판(분실물, 습득물 또는 전체)을 선택해주세요.");
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError(400, "잘못된 요청 본문입니다. 다시 시도해주세요.");
  }

  const rawQuery = formData.get("q");
  const query = typeof rawQuery === "string" && rawQuery.trim() !== "" ? rawQuery.trim() : undefined;
  if (query !== undefined && query.length > MAX_SEARCH_QUERY_LENGTH) {
    return jsonError(400, `검색어는 ${MAX_SEARCH_QUERY_LENGTH}자를 넘을 수 없습니다.`);
  }

  const rawImage = formData.get("image");
  let image: File | undefined;
  if (rawImage instanceof File && rawImage.size > 0) {
    if (!isAllowedImageContentType(rawImage.type)) {
      return jsonError(400, `${ALLOWED_IMAGE_CONTENT_TYPES.join(", ")} 형식의 이미지만 업로드할 수 있습니다.`);
    }
    if (rawImage.size > MAX_IMAGE_SIZE_BYTES) {
      return jsonError(400, "이미지 용량은 10MB를 넘을 수 없습니다.");
    }
    image = rawImage;
  }

  if (query === undefined && image === undefined) {
    return jsonError(400, "검색어 또는 이미지를 입력해주세요.");
  }
  // 이미지 검색(단독이든 텍스트와 결합이든)은 기존 이미지 검색과 동일하게
  // 특정 게시판을 필요로 한다 -- imageEmbedding 컬럼은 LostPost/FoundPost
  // 각자의 컬럼이라 "전체"를 한 번에 조회할 방법이 없다(searchPostsAI's
  // own comment 참고).
  if (image !== undefined && typeResult.data === "all") {
    return jsonError(400, "이미지가 포함된 AI 검색은 분실물 또는 습득물 게시판을 선택한 경우에만 사용할 수 있습니다.");
  }

  const page = parsePageParam(searchParams.get("page"));
  const limit = parseLimitParam(searchParams.get("limit"));

  let result;
  try {
    result = await searchPostsAI(typeResult.data, query, image, { page, limit });
  } catch (error) {
    console.error("AI search failed:", error);
    return jsonError(502, "AI 검색에 실패했습니다. 다시 시도해주세요.");
  }

  return NextResponse.json({
    data: result.items,
    pagination: {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: result.totalPages,
    },
  });
}

export const POST = withErrorHandling(async (request: NextRequest) => {
  // Image/AI search are public, same policy as GET's keyword/semantic
  // search (posts/service.ts) -- no auth gate, checked before
  // requireUserForApi() below (which only ever applies to the "create a
  // post" path).
  if (request.nextUrl.searchParams.get("mode") === "image") {
    return handleImageSearch(request);
  }
  if (request.nextUrl.searchParams.get("mode") === "ai") {
    return handleAiSearch(request);
  }

  const auth = await requireUserForApi();
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "잘못된 요청 본문입니다.");
  }

  const typeResult = postTypeSchema.safeParse((body as { type?: unknown })?.type);
  if (!typeResult.success) {
    return jsonError(400, "type은 'lost' 또는 'found'여야 합니다.");
  }
  const type = typeResult.data;

  if (type === "lost") {
    const parsed = createLostPostSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다.");
    }
    const result = await createLostPost(auth.user, parsed.data);
    return postMutationResultToResponse(result, 201);
  }

  const parsed = createFoundPostSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다.");
  }
  const result = await createFoundPost(auth.user, parsed.data);
  return postMutationResultToResponse(result, 201);
});
