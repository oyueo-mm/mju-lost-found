import { headers } from "next/headers";

import type { PostDTO } from "./service";

// Phase 13-2: /lost, /found, and /search need mode=semantic to actually
// work in production, but their own Server Component functions can't
// import searchPosts() for that path -- see next.config.ts's comment.
// Vercel's Hobby-plan 12-Serverless-Function cap has no room for three
// more routes to each carry their own copy of the ~110MB embedding model +
// onnxruntime native addon (outputFileTracingIncludes), which only
// /api/posts (and the two other pre-existing AI routes) are scoped to.
// So instead of importing searchPosts() in-process for a semantic search,
// these pages fetch the already-deployed /api/posts route -- the exact
// same search logic, running in the one function bundle that actually has
// the model files, with zero duplication of the search implementation
// itself. Keyword-mode searches are unaffected: they never touch the
// embedding path, so those pages keep calling searchPosts() directly (see
// each page's own mode check), with no added network hop.
export type ApiPagedResult = {
  items: PostDTO[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

// Raw JSON has no Date type -- createdAt/updatedAt/lostAt/foundAt come
// back as ISO strings and must be revived into real Date objects, the
// same shape toLostPostDTO()/toFoundPostDTO() produce for the in-process
// path (PostCard's formatDate() requires an actual Date, not a string).
function reviveDates(raw: Record<string, unknown>): PostDTO {
  const revived: Record<string, unknown> = {
    ...raw,
    createdAt: new Date(raw.createdAt as string),
    updatedAt: new Date(raw.updatedAt as string),
  };
  if (raw.type === "lost") revived.lostAt = new Date(raw.lostAt as string);
  else revived.foundAt = new Date(raw.foundAt as string);
  return revived as unknown as PostDTO;
}

// `params` is the page's own already-validated raw search params (plus a
// forced `type`) -- /api/posts re-validates them itself via the same
// listQuerySchema, so this is never a second, divergent source of truth.
export async function fetchPostsFromApi(params: Record<string, string>): Promise<ApiPagedResult> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const proto = requestHeaders.get("x-forwarded-proto") ?? "http";

  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${proto}://${host}/api/posts?${query}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`/api/posts request failed with status ${res.status}`);
  }

  const json = (await res.json()) as {
    data: Record<string, unknown>[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  };

  return {
    items: json.data.map(reviveDates),
    page: json.pagination.page,
    limit: json.pagination.limit,
    total: json.pagination.total,
    totalPages: json.pagination.totalPages,
  };
}
