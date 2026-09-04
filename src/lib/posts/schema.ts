import { z } from "zod";

// Same two enums as prisma/schema.prisma's LostPostStatus/FoundPostStatus
// (which @map to these exact Korean strings) -- kept here as plain string
// literals so this module has no Prisma import and can be unit tested
// without touching the DB layer.
export const LOST_STATUSES = ["찾는 중", "찾음"] as const;
export const FOUND_STATUSES = ["보관 중", "완료"] as const;

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

export const listQuerySchema = z.object({
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
