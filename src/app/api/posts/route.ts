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
  listQuerySchema,
  postTypeSchema,
} from "@/lib/posts/schema";
import { createFoundPost, createLostPost, listFoundPosts, listLostPosts } from "@/lib/posts/service";

export const GET = withErrorHandling(async (request: NextRequest) => {
  const query = listQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) {
    return jsonError(400, "type은 'lost' 또는 'found'여야 합니다.");
  }
  const { type, page, limit } = query.data;

  const result =
    type === "lost" ? await listLostPosts({ page, limit }) : await listFoundPosts({ page, limit });

  return NextResponse.json({
    data: result.items,
    pagination: { page: result.page, limit: result.limit, total: result.total },
  });
});

export const POST = withErrorHandling(async (request: NextRequest) => {
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
