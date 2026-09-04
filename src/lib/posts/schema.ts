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

// Pagination: `limit` is clamped to MAX_LIMIT regardless of what the
// client asks for, so a request like ?limit=100000 can't force a large
// table scan.
export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

export const listQuerySchema = z.object({
  type: postTypeSchema,
  page: z.coerce.number().int().min(1).catch(DEFAULT_PAGE),
  // Anything unparseable (missing, non-numeric, <1) falls back to
  // DEFAULT_LIMIT; anything parseable but too large (e.g. ?limit=100000)
  // is clamped down to MAX_LIMIT rather than rejected outright.
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .catch(DEFAULT_LIMIT)
    .transform((n) => Math.min(n, MAX_LIMIT)),
});

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
