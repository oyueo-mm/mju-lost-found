import type { SearchMode } from "@/lib/posts/schema";

// Phase 13-2: semantic search is a top-K=10 *recommendation*, not a
// paginated "all matching results" list (see docs/AI_SEMANTIC_SEARCH_DESIGN.md
// and Phase 13-1's real-DB pagination analysis -- vector search always runs
// `LIMIT 10` before application pagination even sees the result, so nothing
// past the 10th-best match is ever reachable regardless of page/limit).
// Without this notice, a semantic search that happens to return exactly (or
// fewer than) one page's worth of results renders no Pagination UI at all
// (Pagination returns null when totalPages<=1), leaving no signal that the
// list was capped -- so this always renders in semantic mode, independent
// of item count, and never in keyword mode (where the existing Pagination
// component's total/totalPages already reflect a real, uncapped count).
export function SemanticSearchNotice({ mode }: { mode: SearchMode }) {
  if (mode !== "semantic") return null;

  return (
    <p className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
      AI가 검색어와 가장 관련성이 높은 상위 10건을 보여드립니다.
    </p>
  );
}
