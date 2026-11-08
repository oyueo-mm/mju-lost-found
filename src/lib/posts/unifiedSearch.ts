import { searchPosts as keywordSearch, compareForSort, totalPagesFor, type ListParams, type PagedResult, type PostDTO } from "./service";
import { searchTextCandidatesForFusion } from "./aiService";
import type { PostListType } from "./schema";
import { usesSemanticSearch } from "./searchIntent";
import { reciprocalRankFusion, DEFAULT_RRF_K } from "./reciprocalRankFusion";
import { recordDaily } from "@/lib/metrics/record";

export const UNIFIED_KEYWORD_CANDIDATES = 100;
export type UnifiedSearchResult = PagedResult<PostDTO> & {
  search: { strategy: "keyword" | "hybrid" | "semantic-fallback" | "keyword-fallback"; limited: boolean };
};
type Input = ListParams & { type: PostListType };

export async function searchUnifiedPosts(input: Input, { k = DEFAULT_RRF_K, disableSemantic = false, allowSemantic }: {
  k?: number;
  disableSemantic?: boolean;
  allowSemantic?: () => Promise<boolean>;
} = {}): Promise<UnifiedSearchResult> {
  const { type, page, limit, ...filters } = input;
  const semantic = usesSemanticSearch(input.q);
  const finish = (result: UnifiedSearchResult) => {
    if (input.q?.trim() && page === 1) recordDaily(result.search.strategy === "hybrid" || result.search.strategy === "semantic-fallback" ? "search.semantic" : "search.keyword", [type, input.q.trim(), filters]);
    return result;
  };
  const canSearchMeaning = async () => {
    if (disableSemantic) return false;
    try { return allowSemantic ? await allowSemantic() : true; }
    catch { return false; }
  };
  let keyword: PagedResult<PostDTO>;
  let meaning: PostDTO[] | null;
  if (!semantic) {
    keyword = await keywordSearch(input);
    // A missing page is not a missing query. Only a zero total can trigger AI.
    if (!input.q?.trim() || keyword.total > 0) return finish({ ...keyword, search: { strategy: "keyword", limited: false } });
    if (!await canSearchMeaning()) return finish({ ...keyword, search: { strategy: "keyword-fallback", limited: false } });
    meaning = await searchTextCandidatesForFusion(type, input.q.trim(), filters).catch(() => null);
  } else {
    if (!await canSearchMeaning()) return finish({ ...await keywordSearch(input), search: { strategy: "keyword-fallback", limited: false } });
    [keyword, meaning] = await Promise.all([
      keywordSearch({ ...input, page: 1, limit: UNIFIED_KEYWORD_CANDIDATES }),
      searchTextCandidatesForFusion(type, input.q!.trim(), filters).catch(() => null),
    ]);
  }
  if (meaning === null) {
    if (!semantic) return finish({ ...keyword, search: { strategy: "keyword-fallback", limited: false } });
    // Reuse the already-fetched keyword page where possible. A failure
    // restores full keyword counts/pagination rather than a truncated pool.
    const offset = (page - 1) * limit;
    const fallback = offset + limit <= keyword.items.length || keyword.total <= keyword.items.length
      ? { ...keyword, items: keyword.items.slice(offset, offset + limit), page, limit, totalPages: totalPagesFor(keyword.total, limit) }
      : await keywordSearch(input);
    return finish({ ...fallback, search: { strategy: "keyword-fallback", limited: false } });
  }
  const compare = (sort: ListParams["sort"], a: PostDTO, b: PostDTO) => compareForSort(sort)({ ...a, commentCount: a.commentCount ?? 0 }, { ...b, commentCount: b.commentCount ?? 0 }) || a.type.localeCompare(b.type);
  const tieBreak = (a: PostDTO, b: PostDTO) => compare("latest", a, b);
  let items = reciprocalRankFusion([
    { items: keyword.items }, { items: meaning },
  ], { key: (post) => `${post.type}:${post.id}`, tieBreak, k }).map(({ item }) => {
    // A fusion score is not a similarity percentage. Do not leak the old
    // semantic score into a unified card's similarity badge.
    const { score, ...post } = item;
    void score;
    return post as PostDTO;
  });
  if (filters.sort && filters.sort !== "relevance") items = items.sort((a, b) => compare(filters.sort, a, b));
  const total = items.length;
  return finish({
    items: items.slice((page - 1) * limit, page * limit), page, limit, total, totalPages: totalPagesFor(total, limit),
    search: { strategy: semantic ? "hybrid" : "semantic-fallback", limited: keyword.total > keyword.items.length },
  });
}
