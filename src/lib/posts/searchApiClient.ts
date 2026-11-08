import type { PostDTO } from "./service";
import { reviveDates } from "./reviveDates";

// Browser-only caller: keep inference in /api/posts's existing AI bundle.
// A server self-fetch loses the visitor's Deployment Protection session
// and follows the SSO redirect to HTML. A relative browser request uses
// the normal same-origin session without a protection bypass or model
// copies in the page functions.
export type ApiPagedResult = {
  items: PostDTO[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  search?: { strategy: "keyword" | "hybrid" | "semantic-fallback" | "keyword-fallback"; limited: boolean };
};

// `params` is the page's own already-validated raw search params (plus a
// forced `type`) -- /api/posts re-validates them itself via the same
// listQuerySchema, so this is never a second, divergent source of truth.
export async function fetchPostsFromApi(params: Record<string, string>, signal?: AbortSignal): Promise<ApiPagedResult> {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`/api/posts?${query}`, {
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
    signal,
  });
  if (!res.ok) {
    throw new Error(`/api/posts request failed with status ${res.status}`);
  }
  if (!res.headers.get("content-type")?.includes("application/json")) {
    throw new Error("/api/posts returned a non-JSON response");
  }

  const json = (await res.json()) as {
    data: Record<string, unknown>[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
    search?: ApiPagedResult["search"];
  };

  return {
    items: json.data.map(reviveDates),
    page: json.pagination.page,
    limit: json.pagination.limit,
    total: json.pagination.total,
    totalPages: json.pagination.totalPages,
    ...(json.search && { search: json.search }),
  };
}

export async function fetchImagePosts(params: URLSearchParams, file: File, signal?: AbortSignal): Promise<ApiPagedResult> {
  const query = new URLSearchParams(params);
  query.set("mode", "ai");
  const body = new FormData();
  body.set("image", file);
  if (query.get("q")) body.set("q", query.get("q")!);
  query.delete("q");
  const response = await fetch(`/api/posts?${query}`, { method: "POST", body, credentials: "same-origin", redirect: "error", signal });
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("Image search request failed");
  const json = await response.json();
  return { items: json.data.map(reviveDates), ...json.pagination };
}
