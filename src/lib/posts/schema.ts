import { z } from "zod";

import { DATE_ONLY, EVENT_PERIODS, kstDateOnly, kstStartOfDay, resolveEventRange } from "./eventPeriod";
import { dateOnlyToDb, isValidDateOnly, isValidTimeOnly, kstInstantFromParts } from "./eventDate";
import { interpretDateTimeLocalAsKst } from "./kstDateTime";
import { resolveCategoryWrite, type ResolvedCategoryWrite } from "./categoryWrite";
import { isCategoryCode, isSubcategoryCode, parentCategoryOf } from "./categoryTaxonomy";

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

// 기간 검색 필터 (분실/습득 날짜 기준 -- lostDate / foundDate, never
// createdAt; a post whose date is known but time isn't still matches its
// day). URL shape: period=today|3d|1w|1m|custom, from/to=YYYY-MM-DD (KST
// dates, custom only), unknownTime=include ("날짜 모름 포함": also include
// posts whose date itself is unknown/null -- the param keeps its old name
// so existing links still work). Resolved into eventFrom/eventTo instants by
// withEventRange() below; shared by listQuerySchema and the AI search route.
const dateOnlyParam = (label: string) =>
  z
    .string()
    .regex(DATE_ONLY, `${label}은(는) YYYY-MM-DD 형식이어야 합니다.`)
    .refine((value) => kstStartOfDay(value) !== null, `${label}이(가) 올바른 날짜가 아닙니다.`);

const eventPeriodFields = {
  period: z.enum(EVENT_PERIODS).optional(),
  from: dateOnlyParam("시작일").optional(),
  to: dateOnlyParam("종료일").optional(),
  unknownTime: z.enum(["include"]).optional(),
};

type EventPeriodInput = { period?: (typeof EVENT_PERIODS)[number]; from?: string; to?: string; unknownTime?: "include" };

function refineEventPeriod(data: EventPeriodInput, ctx: z.RefinementCtx) {
  if (data.period === "custom" && data.from && data.to && data.from > data.to) {
    ctx.addIssue({ code: "custom", path: ["to"], message: "종료일은 시작일보다 빠를 수 없습니다." });
  }
}

// Adds the resolved filter fields the services read. eventFrom/eventTo are
// undefined when no period applies (전체), in which case unknownTime has no
// effect either -- nothing is filtered by time at all.
function withEventRange<T extends EventPeriodInput>(data: T) {
  const range = resolveEventRange(data);
  return {
    ...data,
    eventFrom: range?.from,
    eventTo: range?.to,
    includeUnknownEventTime: range ? data.unknownTime === "include" : undefined,
  };
}

export const eventPeriodQuerySchema = z.object(eventPeriodFields).superRefine(refineEventPeriod).transform(withEventRange);

// 카테고리 대분류-소분류 검색 필터: categoryCode (대분류 전체) and/or
// subcategory (그 소분류만 -- implies its own parent, so ?subcategory= alone
// works too). Filters the new category_code/subcategory columns; the legacy
// free-text `category` param keeps filtering the legacy column unchanged.
// Shared by listQuerySchema and the AI search route. An empty value means
// "no filter", same as the other optional search params.
const categoryFilterFields = {
  categoryCode: z.string().trim().max(50).optional(),
  subcategory: z.string().trim().max(100).optional(),
};

type CategoryFilterInput = { categoryCode?: string; subcategory?: string };

function refineCategoryFilter(data: CategoryFilterInput, ctx: z.RefinementCtx) {
  if (data.categoryCode && !isCategoryCode(data.categoryCode)) {
    ctx.addIssue({ code: "custom", path: ["categoryCode"], message: "카테고리 값이 올바르지 않습니다." });
  }
  if (data.subcategory) {
    if (!isSubcategoryCode(data.subcategory)) {
      ctx.addIssue({ code: "custom", path: ["subcategory"], message: "소분류 값이 올바르지 않습니다." });
    } else if (data.categoryCode && parentCategoryOf(data.subcategory) !== data.categoryCode) {
      ctx.addIssue({ code: "custom", path: ["subcategory"], message: "소분류가 선택한 카테고리에 속하지 않습니다." });
    }
  }
}

function withCategoryFilter<T extends CategoryFilterInput>(data: T) {
  const subcategory = data.subcategory && isSubcategoryCode(data.subcategory) ? data.subcategory : undefined;
  const categoryCode = data.categoryCode || (subcategory ? parentCategoryOf(subcategory) : undefined);
  return { ...data, categoryCode: categoryCode || undefined, subcategory };
}

export const categoryFilterQuerySchema = z
  .object(categoryFilterFields)
  .superRefine(refineCategoryFilter)
  .transform(withCategoryFilter);

export const listQuerySchema = z
  .object({
    type: postListTypeSchema,
    // All search/filter fields are optional -- omitting them means "no
    // filter", not an error. Unlike page/limit (which silently fall back to
    // safe defaults, see below), an out-of-range q/date/sort is a genuine
    // client mistake and is rejected with 400 rather than silently ignored.
    q: z.string().trim().max(MAX_SEARCH_QUERY_LENGTH, "검색어는 100자를 넘을 수 없습니다.").optional(),
    category: z.string().trim().max(100).optional(),
    ...categoryFilterFields,
    // Phase 31: replaces the old free-text `location` search filter --
    // campus is a fixed enum (unlike category, an out-of-list value is
    // rejected rather than silently kept, since there's no legacy data to
    // stay compatible with).
    campus: z.enum(CAMPUSES).optional(),
    ...eventPeriodFields,
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
    refineEventPeriod(data, ctx);
    refineCategoryFilter(data, ctx);
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
  })
  .transform((data) => withCategoryFilter(withEventRange(data)));
export type ListQuery = z.infer<typeof listQuerySchema>;

// Shared fields between LostPost/FoundPost -- title/description/category/
// location are unbounded TEXT in the DB (see schema.prisma), but a public
// write API needs its own sane upper bounds regardless of what the column
// itself allows.
export const POST_TITLE_MAX_LENGTH = 200;
export const POST_DESCRIPTION_MAX_LENGTH = 5000;

const title = z.string().trim().min(1, "제목을 입력해주세요.").max(POST_TITLE_MAX_LENGTH);
const description = z
  .string()
  .trim()
  .min(1, "설명을 입력해주세요.")
  .max(POST_DESCRIPTION_MAX_LENGTH);
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

// 분실/습득 일시: a timezone-less datetime-local value is a KST wall-clock
// time (see kstDateTime.ts for why it must not be parsed in the server's
// own timezone); null stays null (시간 모름).
function eventDateTime(message: string) {
  return z.preprocess(interpretDateTimeLocalAsKst, z.coerce.date(message).nullable());
}

// 분실/습득 날짜/시각 분리 (see eventDate.ts): the form sends the date and
// the time separately -- lostDate/foundDate ("YYYY-MM-DD" KST date, or
// null = 날짜 모름) and lostTime/foundTime ("HH:mm" KST, or null = 시간
// 모름). A client that still sends only the single lostAt/foundAt instant
// keeps working: its KST date becomes the date. Either way the service
// receives exactly the two columns, { date, at }, with `at` set only when
// a real time was given -- a date alone never gets a made-up time.
const eventDateOnly = z
  .string()
  .regex(DATE_ONLY, "날짜는 YYYY-MM-DD 형식이어야 합니다.")
  .refine(isValidDateOnly, "올바른 날짜가 아닙니다.")
  .nullable();
const eventTimeOnly = z.string().refine(isValidTimeOnly, "시간은 HH:mm 형식이어야 합니다.").nullable();

type EventBoard = "lost" | "found";
const EVENT_KEYS = {
  lost: { date: "lostDate", time: "lostTime", at: "lostAt", label: "분실" },
  found: { date: "foundDate", time: "foundTime", at: "foundAt", label: "습득" },
} as const;
type LostEventKey = "lostDate" | "lostTime" | "lostAt";
type FoundEventKey = "foundDate" | "foundTime" | "foundAt";
type ResolvedEvent<D extends string, A extends string> = { [K in D | A]: Date | null };

type EventWrite = { ok: true; value?: { date: Date | null; at: Date | null } } | { ok: false; message: string };

export function resolveEventWrite(
  raw: { date?: string | null; time?: string | null; at?: Date | null },
  mode: "create" | "update",
  label: string,
): EventWrite {
  if (raw.date !== undefined) {
    if (raw.date === null) {
      if (raw.time) return { ok: false, message: `${label} 날짜 없이 시간만 입력할 수 없습니다.` };
      return { ok: true, value: { date: null, at: null } };
    }
    return {
      ok: true,
      value: { date: dateOnlyToDb(raw.date), at: raw.time ? kstInstantFromParts(raw.date, raw.time) : null },
    };
  }
  if (raw.time !== undefined) return { ok: false, message: `${label} 날짜 없이 시간만 입력할 수 없습니다.` };
  if (raw.at !== undefined) {
    return { ok: true, value: raw.at ? { date: dateOnlyToDb(kstDateOnly(raw.at)), at: raw.at } : { date: null, at: null } };
  }
  if (mode === "create") return { ok: false, message: `${label} 일시가 올바르지 않습니다.` };
  return { ok: true };
}

function applyEventWrite(data: Record<string, unknown>, ctx: z.RefinementCtx, board: EventBoard, mode: "create" | "update") {
  // The category step already failed (and reported its own issue).
  if ((data as unknown) === z.NEVER) return z.NEVER;
  const keys = EVENT_KEYS[board];
  const { [keys.date]: date, [keys.time]: time, [keys.at]: at, ...rest } = data;
  const result = resolveEventWrite(
    { date: date as string | null | undefined, time: time as string | null | undefined, at: at as Date | null | undefined },
    mode,
    keys.label,
  );
  if (!result.ok) {
    ctx.addIssue({ code: "custom", message: result.message, path: [keys.date] });
    return z.NEVER;
  }
  return result.value ? { ...rest, [keys.date]: result.value.date, [keys.at]: result.value.at } : rest;
}

// 카테고리 대분류-소분류: a request carries either the new
// categoryCode/subcategory (current PostForm) or only the legacy
// `category` (clients from before the taxonomy). Both are optional at the
// field level; resolveCategoryWrite() (categoryWrite.ts) then requires one
// on create, checks the parent-child pair, and normalizes the result into
// all three columns (dual-write) -- see applyCategoryWrite below.
const categoryFields = {
  category: category.optional(),
  categoryCode: z.string().trim().max(50).optional(),
  subcategory: z.string().trim().max(100).nullable().optional(),
};

type CategoryFieldKeys = "category" | "categoryCode" | "subcategory";
type RawCategoryFields = { category?: string; categoryCode?: string; subcategory?: string | null };

// What a create hands to the service: `category` is always set; the new
// columns are optional in the type only so older service-level callers
// (and their tests) that pass just a legacy category still type-check --
// the schema itself always fills all three.
type CreateCategoryWrite = Pick<ResolvedCategoryWrite, "category"> & Partial<Omit<ResolvedCategoryWrite, "category">>;

// Replaces the raw category fields with resolveCategoryWrite()'s result:
// on create always {category, categoryCode, subcategory}; on update the
// same three, or none of them when the request didn't touch the category.
function applyCategoryWrite<T extends RawCategoryFields>(data: T, ctx: z.RefinementCtx, mode: "create" | "update") {
  const { category: legacy, categoryCode, subcategory, ...rest } = data;
  const result = resolveCategoryWrite({ category: legacy, categoryCode, subcategory }, mode);
  if (!result.ok) {
    ctx.addIssue({ code: "custom", message: result.message, path: ["categoryCode"] });
    return z.NEVER;
  }
  return { ...rest, ...(result.value ?? {}) };
}

function createWithCategory<T extends RawCategoryFields>(data: T, ctx: z.RefinementCtx) {
  return applyCategoryWrite(data, ctx, "create") as Omit<T, CategoryFieldKeys> & CreateCategoryWrite;
}

function updateWithCategory<T extends RawCategoryFields>(data: T, ctx: z.RefinementCtx) {
  return applyCategoryWrite(data, ctx, "update") as Omit<T, CategoryFieldKeys> & Partial<ResolvedCategoryWrite>;
}

const lostPostFields = z.object({
  title,
  description,
  ...categoryFields,
  location,
  campus,
  // 분실 날짜/시각 분리: see resolveEventWrite above. lostAt is the legacy
  // single-instant input (older clients); the form sends lostDate+lostTime.
  lostDate: eventDateOnly.optional(),
  lostTime: eventTimeOnly.optional(),
  lostAt: eventDateTime("분실 일시가 올바르지 않습니다.").optional(),
  status: z.enum(LOST_STATUSES).optional(),
  organizationId,
});

export const createLostPostSchema = lostPostFields.transform((data, ctx) => {
  const withCategory = createWithCategory(data, ctx);
  return applyEventWrite(withCategory, ctx, "lost", "create") as Omit<typeof withCategory, LostEventKey> &
    ResolvedEvent<"lostDate", "lostAt">;
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
export const updateLostPostSchema = lostPostFields.partial().transform((data, ctx) => {
  const withCategory = updateWithCategory(data, ctx);
  return applyEventWrite(withCategory, ctx, "lost", "update") as Omit<typeof withCategory, LostEventKey> &
    Partial<ResolvedEvent<"lostDate", "lostAt">>;
});
export type UpdateLostPostInput = z.infer<typeof updateLostPostSchema>;

const foundPostFields = z.object({
  title,
  description,
  ...categoryFields,
  location,
  campus,
  foundDate: eventDateOnly.optional(),
  foundTime: eventTimeOnly.optional(),
  foundAt: eventDateTime("습득 일시가 올바르지 않습니다.").optional(),
  status: z.enum(FOUND_STATUSES).optional(),
  organizationId,
});

export const createFoundPostSchema = foundPostFields.transform((data, ctx) => {
  const withCategory = createWithCategory(data, ctx);
  return applyEventWrite(withCategory, ctx, "found", "create") as Omit<typeof withCategory, FoundEventKey> &
    ResolvedEvent<"foundDate", "foundAt">;
});
export type CreateFoundPostInput = z.infer<typeof createFoundPostSchema>;

// See updateLostPostSchema's own comment -- identical shape/reasoning.
export const updateFoundPostSchema = foundPostFields.partial().transform((data, ctx) => {
  const withCategory = updateWithCategory(data, ctx);
  return applyEventWrite(withCategory, ctx, "found", "update") as Omit<typeof withCategory, FoundEventKey> &
    Partial<ResolvedEvent<"foundDate", "foundAt">>;
});
export type UpdateFoundPostInput = z.infer<typeof updateFoundPostSchema>;
