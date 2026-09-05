import { z } from "zod";

// Same two enums as prisma/schema.prisma's LostPostStatus/FoundPostStatus
// (which @map to these exact Korean strings) -- kept here as plain string
// literals so this module has no Prisma import and can be unit tested
// without touching the DB layer.
export const LOST_STATUSES = ["찾는 중", "찾음"] as const;
export const FOUND_STATUSES = ["보관 중", "완료"] as const;

// Same fixed list as the legacy ui/common.py::CATEGORIES -- the single
// canonical definition every create/edit form and search filter (Phase 9)
// reads from, instead of each place hand-typing its own copy. Kept as
// plain data (not a zod enum) on purpose: the `category` field below stays
// free-text server-side (existing posts, and any category value already
// in the DB from before this list was enforced in the UI, must keep
// working -- see PostForm's/SearchFilterBar's own handling of a value
// outside this list). This is a UI-level canonical list, not a DB
// constraint, matching the legacy app's own st.selectbox(CATEGORIES)
// (client-side only; the DB column itself was never CHECK-constrained).
export const CATEGORIES = [
  "전자기기",
  "필기구",
  "책",
  "지갑",
  "카드",
  "의류",
  "가방",
  "액세서리",
  "기타",
] as const;

export const POST_TYPES = ["lost", "found"] as const;
export type PostType = (typeof POST_TYPES)[number];

export const postTypeSchema = z.enum(POST_TYPES);

// The list/search endpoint additionally accepts "all" (both boards
// merged) -- kept as a separate schema from postTypeSchema because
// create/update/get/delete only ever make sense for one concrete board.
export const POST_LIST_TYPES = ["lost", "found", "all"] as const;
export type PostListType = (typeof POST_LIST_TYPES)[number];
export const postListTypeSchema = z.enum(POST_LIST_TYPES);

export const SORT_OPTIONS = ["latest", "oldest"] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];
const sortOptionSchema = z.enum(SORT_OPTIONS);

// Phase 12: search mode. "keyword" (default) is the existing title/
// description `contains` search, unchanged. "semantic" runs the query
// through the same embedding pipeline post matching already uses
// (docs/AI_SEMANTIC_SEARCH_DESIGN.md) and ranks by pgvector cosine
// similarity instead. An unrecognized mode value is a validation error,
// not a silent fallback to keyword -- same "genuine client mistake ->
// 400" policy the rest of this schema already applies to q/sort/status.
export const SEARCH_MODES = ["keyword", "semantic"] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];
const searchModeSchema = z.enum(SEARCH_MODES);

// A search box, unlike a form field, has no natural upper bound from the
// legacy schema -- this cap exists purely so an absurdly long query
// string can't be used to build a pointless/abusive LIKE query.
export const MAX_SEARCH_QUERY_LENGTH = 100;

// Pagination: `limit` is clamped to MAX_LIMIT regardless of what the
// client asks for, so a request like ?limit=100000 can't force a large
// table scan.
export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
export const DEFAULT_SORT: SortOption = "latest";

export const listQuerySchema = z
  .object({
    type: postListTypeSchema,
    // All search/filter fields are optional -- omitting them means "no
    // filter", not an error. Unlike page/limit (which silently fall back to
    // safe defaults, see below), an out-of-range q/date/sort is a genuine
    // client mistake and is rejected with 400 rather than silently ignored.
    q: z.string().trim().max(MAX_SEARCH_QUERY_LENGTH, "검색어는 100자를 넘을 수 없습니다.").optional(),
    category: z.string().trim().max(100).optional(),
    location: z.string().trim().max(200).optional(),
    dateFrom: z.coerce.date("dateFrom이 올바르지 않습니다.").optional(),
    dateTo: z.coerce.date("dateTo가 올바르지 않습니다.").optional(),
    // Board-specific (Phase 9): LostPost's two statuses differ from
    // FoundPost's, so which values are valid depends on `type` -- checked
    // below in .superRefine(), not with a flat z.enum() here. Kept as a
    // permissive string at this level so the specific-vs-invalid
    // distinction can produce one clear error message instead of zod's
    // generic "invalid enum value".
    status: z.string().trim().max(20).optional(),
    mode: searchModeSchema.optional().default("keyword"),
    sort: sortOptionSchema.optional(),
    page: z.coerce.number().int().min(1).catch(DEFAULT_PAGE),
    // Anything unparseable (missing, non-numeric, <1) falls back to
    // DEFAULT_LIMIT; anything parseable but too large (e.g. ?limit=100000)
    // is clamped down to MAX_LIMIT rather than rejected outright. This
    // lenient behavior predates this phase (Phase 3) and is left as-is.
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .catch(DEFAULT_LIMIT)
      .transform((n) => Math.min(n, MAX_LIMIT)),
  })
  .superRefine((data, ctx) => {
    if (data.status !== undefined) {
      // type=all merges LostPost and FoundPost, which don't share a status
      // vocabulary -- rather than guess which board a bare status string was
      // meant for (and risk silently filtering out the wrong board's rows,
      // which would look like "results are missing" rather than an error),
      // a status filter is only accepted once a specific board is chosen.
      if (data.type === "all") {
        ctx.addIssue({
          code: "custom",
          path: ["status"],
          message: "status 필터는 게시판(분실물/습득물)을 선택한 경우에만 사용할 수 있습니다.",
        });
      } else {
        const validStatuses: readonly string[] = data.type === "lost" ? LOST_STATUSES : FOUND_STATUSES;
        if (!validStatuses.includes(data.status)) {
          ctx.addIssue({ code: "custom", path: ["status"], message: "status 값이 올바르지 않습니다." });
        }
      }
    }

    // Phase 12: semantic search always ranks within one board's embedding
    // column (LostPost.embedding or FoundPost.embedding) -- there is no
    // cross-table pgvector UNION, and merging two independently-ranked
    // similarity lists (as type=all's keyword path does for createdAt)
    // would require re-scoring against a shared scale that doesn't exist
    // here. Same "reject the ambiguous combination outright" policy as
    // status+type=all just above, not a new pattern.
    if (data.mode === "semantic") {
      if (data.type === "all") {
        ctx.addIssue({
          code: "custom",
          path: ["mode"],
          message: "AI 의미 검색은 게시판(분실물/습득물)을 선택한 경우에만 사용할 수 있습니다.",
        });
      }
      if (!data.q || data.q.trim() === "") {
        ctx.addIssue({ code: "custom", path: ["q"], message: "AI 의미 검색은 검색어가 필요합니다." });
      }
    }
  });
export type ListQuery = z.infer<typeof listQuerySchema>;

// Shared fields between LostPost/FoundPost -- title/description/category/
// location are unbounded TEXT in the DB (see schema.prisma), but a public
// write API needs its own sane upper bounds regardless of what the column
// itself allows.
const title = z.string().trim().min(1, "제목을 입력해주세요.").max(200);
const description = z.string().trim().min(1, "설명을 입력해주세요.").max(5000);
const category = z.string().trim().min(1, "카테고리를 입력해주세요.").max(100);
const location = z.string().trim().min(1, "위치를 입력해주세요.").max(200);

export const createLostPostSchema = z.object({
  title,
  description,
  category,
  location,
  lostAt: z.coerce.date("분실 일시가 올바르지 않습니다."),
  status: z.enum(LOST_STATUSES).optional(),
});
export type CreateLostPostInput = z.infer<typeof createLostPostSchema>;

export const updateLostPostSchema = createLostPostSchema.partial();
export type UpdateLostPostInput = z.infer<typeof updateLostPostSchema>;

export const createFoundPostSchema = z.object({
  title,
  description,
  category,
  location,
  foundAt: z.coerce.date("습득 일시가 올바르지 않습니다."),
  status: z.enum(FOUND_STATUSES).optional(),
});
export type CreateFoundPostInput = z.infer<typeof createFoundPostSchema>;

export const updateFoundPostSchema = createFoundPostSchema.partial();
export type UpdateFoundPostInput = z.infer<typeof updateFoundPostSchema>;
