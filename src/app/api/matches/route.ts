import { NextRequest } from "next/server";

import {
  jsonError,
  jsonOk,
  matchMutationResultToResponse,
  requireUserForApi,
  withErrorHandling,
} from "@/lib/match/http";
import { createMatchSchema, matchQuerySchema } from "@/lib/match/schema";
import { createMatch, listMatchesForPost, listMatchesForUser } from "@/lib/match/service";

// GET /api/matches               -> every match the current user is party to
// GET /api/matches?postId=&type= -> matches for one specific post the
//                                    current user owns (403 otherwise)
// Always requires auth: a match reveals which two posts (and therefore
// which two users) are paired up, which isn't public information the way
// the posts themselves are.
export const GET = withErrorHandling(async (request: NextRequest) => {
  const auth = await requireUserForApi();
  if ("response" in auth) return auth.response;

  const query = matchQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) {
    return jsonError(400, query.error.issues[0]?.message ?? "잘못된 요청입니다.");
  }

  if (query.data.postId !== undefined && query.data.type !== undefined) {
    const result = await listMatchesForPost(query.data.type, query.data.postId, auth.user.id);
    return matchMutationResultToResponse(result);
  }

  const matches = await listMatchesForUser(auth.user.id);
  return jsonOk(matches);
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

  const parsed = createMatchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다.");
  }

  const result = await createMatch(auth.user, parsed.data);
  return matchMutationResultToResponse(result, 201);
});
