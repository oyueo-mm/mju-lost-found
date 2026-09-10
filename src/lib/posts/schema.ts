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

// Phase 31: the two real MJU campuses. Unlike CATEGORIES above, this is a
// brand-new field (no pre-existing free-text data to stay compatible
// with), so it's a real zod enum -- an out-of-list value is a validation
// error, not silently accepted. DEFAULT_CAMPUS matches the DB column's
// own default (see schema.prisma), so a create request that omits campus
// and one that explicitly sends "인문캠퍼스" behave identically.
export const CAMPUSES = ["인문캠퍼스", "자연캠퍼스"] as const;
export const DEFAULT_CAMPUS: (typeof CAMPUSES)[number] = "인문캠퍼스";

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
    // Phase 31: replaces the old free-text `location` search filter --
    // campus is a fixed enum (unlike category, an out-of-list value is
    // rejected rather than silently kept, since there's no legacy data to
    // stay compatible with).
    campus: z.enum(CAMPUSES).optional(),
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

    // Phase 11-2: type=all + mode=semantic is now allowed -- both boards'
    // embedding columns come from the exact same model applied to the
    // exact same buildEmbeddingText() shape (see LostPost.embedding's own
    // schema.prisma comment: "identical shape/reasoning" as
    // FoundPost.embedding), so their cosine-similarity scores already
    // live on the same 0-1 scale (see vectorSearch.ts's normalizeScore).
    // There's no cross-table pgvector UNION, but aiService.ts's
    // searchPostsSemanticAll() doesn't need one -- it ranks each board
    // independently (same query vector) and merges by that already-
    // comparable score, the same way type=all's keyword path merges by
    // createdAt. status+type=all above stays rejected (LostPost/FoundPost
    // don't share a status vocabulary at all, so there's no equivalent
    // "already comparable" scale to merge on) -- this is a narrower,
    // deliberate exception, not a general softening of that rule.
    if (data.mode === "semantic") {
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
// Phase P-5: `.nullable()`, not `.optional()` -- the field must still be
// present on every create (the form always sends either a real value or
// an explicit null, see PostForm.tsx's locationUnknown toggle), but its
// value can genuinely be "unknown" (null) instead of a non-empty string.
// null means "the poster doesn't know", never coerced from/to an empty
// string or a placeholder like "미상" -- see schema.prisma's own comment
// on LostPost.location for why that distinction matters downstream
// (search, embedding).
const location = z.string().trim().min(1, "위치를 입력해주세요.").max(200).nullable();
// Phase 31: required on every create -- unlike location (free text, no
// fixed list), an omitted/invalid campus is a validation error rather
// than falling back to DEFAULT_CAMPUS server-side, so the form's own
// pre-selected default is what actually reaches the API.
const campus = z.enum(CAMPUSES, "캠퍼스를 선택해주세요.");

// Phase 12-5: optional org attribution. Only shape-validated here (a
// positive integer, or absent/null for a personal post) -- existence/
// ACTIVE/membership/role are never decided by zod, only by
// validateOrganizationPosting() in service/aiService (§8 of this phase's
// spec: schema validation is never the last word on whether the post is
// actually allowed to attribute to that organization).
const organizationId = z.number().int().positive().nullable().optional();

export const createLostPostSchema = z.object({
  title,
  description,
  category,
  location,
  campus,
  // Phase P-5: same nullable-not-optional shape as `location` above --
  // always present, either a real coerced Date or an explicit null for
  // "시간 미상" (see PostForm.tsx's dateUnknown toggle).
  lostAt: z.coerce.date("분실 일시가 올바르지 않습니다.").nullable(),
  status: z.enum(LOST_STATUSES).optional(),
  organizationId,
});
export type CreateLostPostInput = z.infer<typeof createLostPostSchema>;

// Phase 12-7: organizationId is now editable (this phase reverses Phase
// 12-5's §10 "fixed at creation" policy -- see this phase's own spec §4:
// 개인→단체/단체 A→단체 B/단체→개인 전환을 모두 지원한다). Shape-only here,
// same as the create schema's own organizationId -- omitted means "leave
// attribution unchanged", explicit null means "personal", a positive
// integer is re-validated against the *current* user's membership by
// validateOrganizationPosting() in updateLostPost/updateFoundPost, never
// trusted from this schema alone.
export const updateLostPostSchema = createLostPostSchema.partial();
export type UpdateLostPostInput = z.infer<typeof updateLostPostSchema>;

export const createFoundPostSchema = z.object({
  title,
  description,
  category,
  location,
  campus,
  foundAt: z.coerce.date("습득 일시가 올바르지 않습니다.").nullable(),
  status: z.enum(FOUND_STATUSES).optional(),
  organizationId,
});
export type CreateFoundPostInput = z.infer<typeof createFoundPostSchema>;

// See updateLostPostSchema's own comment -- identical shape/reasoning.
export const updateFoundPostSchema = createFoundPostSchema.partial();
export type UpdateFoundPostInput = z.infer<typeof updateFoundPostSchema>;
