import { prisma } from "@/lib/db/prisma";
import { deleteObjectSafely } from "@/lib/images/supabaseAdmin";
import {
  FoundPostStatus as PrismaFoundPostStatus,
  LostPostStatus as PrismaLostPostStatus,
} from "@/generated/prisma/client";
import type { PostListType, SortOption } from "./schema";
import { DEFAULT_SORT } from "./schema";

// Phase 21: this module is the AI-dependency-free half of the old
// posts/service.ts split (see docs/AI_MATCHING_ARCHITECTURE.md's Phase 21
// note) -- every function here only ever touches Prisma, never
// @/lib/ai/*. createLostPost/updateLostPost/createFoundPost/
// updateFoundPost (which trigger embedPostBestEffort), searchPostsSemantic,
// and findSimilarPostsByImageForDisplay live in ./aiService instead, which
// imports the plain helpers/types below from this file. Routes and pages
// that only need CRUD/listing (found/lost/search's keyword path,
// posts/mine, post/[id]/edit) import exclusively from this file so their
// Vercel function bundle never traces @huggingface/transformers -- see
// Phase 20's report for why that import alone, even a lazily `import()`'d
// one, previously made every one of those routes an oversized, un-
// mergeable Serverless Function.

// The Prisma Client's generated enum types use the ASCII identifiers
// (SEARCHING/FOUND, ...) as their actual TS/JS values -- @map in
// schema.prisma only renames the value stored in the DB column, it
// doesn't change what the generated client accepts/returns. The rest of
// this app (zod schemas, the API, the UI) speaks the real legacy Korean
// values, so every DB read/write through this service converts here, in
// one place, rather than leaking the Prisma-internal identifiers upward.
export const LOST_STATUS_TO_DB: Record<string, PrismaLostPostStatus> = {
  "찾는 중": PrismaLostPostStatus.SEARCHING,
  "찾음": PrismaLostPostStatus.FOUND,
};
const LOST_STATUS_FROM_DB: Record<PrismaLostPostStatus, string> = {
  SEARCHING: "찾는 중",
  FOUND: "찾음",
};
export const FOUND_STATUS_TO_DB: Record<string, PrismaFoundPostStatus> = {
  "보관 중": PrismaFoundPostStatus.KEEPING,
  "완료": PrismaFoundPostStatus.COMPLETED,
};
const FOUND_STATUS_FROM_DB: Record<PrismaFoundPostStatus, string> = {
  KEEPING: "보관 중",
  COMPLETED: "완료",
};

// Only ever the fields safe to show publicly (see ui/auth.py: "nickname is
// the only identity shown publicly") -- never email, isAdmin, isSuspended,
// etc, regardless of how much of `User` a caller might otherwise have
// access to. `publicId` (Phase H-7) is included alongside `id` so callers
// can link to /profile/[publicId] without a second query -- `id` itself
// stays for internal use (e.g. "is this the current user's own post"), it
// is never rendered as a link target.
export const AUTHOR_SELECT = { id: true, nickname: true, publicId: true } as const;
export type Author = { id: number; nickname: string | null; publicId: string };

export type LostPostDTO = {
  id: number;
  type: "lost";
  title: string;
  description: string;
  category: string;
  location: string;
  campus: string;
  status: string;
  imageUrl: string | null;
  lostAt: Date;
  createdAt: Date;
  updatedAt: Date;
  author: Author;
  // Phase 23: plain counter, see LostPost.viewCount's schema comment.
  viewCount: number;
  // Phase 12/15-2: only ever set on a semantic-search or image-similarity
  // result (normalizeScore()'s 0-1 scale, same as Match.score) -- absent
  // (never present-but-null) on every other DTO-producing path (list/get/
  // create/update, keyword search), so a plain keyword result is never
  // mistaken for having been similarity-ranked. Which of the two it means
  // is purely which caller populated it (searchPostsSemantic's text
  // similarity, or findSimilarPostsByImageForDisplay's image similarity) --
  // the UI is what's responsible for labeling it correctly ("검색 유사도"
  // vs "이미지 유사도", see PostCard's scoreLabel prop), never this field
  // itself.
  score?: number;
};

export type FoundPostDTO = {
  id: number;
  type: "found";
  title: string;
  description: string;
  category: string;
  location: string;
  campus: string;
  status: string;
  imageUrl: string | null;
  foundAt: Date;
  createdAt: Date;
  updatedAt: Date;
  author: Author;
  viewCount: number;
  score?: number;
};

export type PostDTO = LostPostDTO | FoundPostDTO;

export type PostMutationResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "not_found" }
  | { kind: "forbidden"; reason: "not_owner" | "suspended" };

type Page = { page: number; limit: number };
export type PagedResult<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

// Optional search/filter criteria shared by LostPost and FoundPost -- both
// models have identically-named/typed title/description/category/location/
// createdAt columns (see schema.prisma), so one filter shape and one
// where-builder serves both without a generic repository abstraction.
export type PostFilters = {
  q?: string;
  category?: string;
  // Phase 31: replaces the old free-text `location` search filter with an
  // exact match on the fixed campus enum -- see buildSearchWhere's own
  // comment. `location` remains a real post field (LostPostDTO/
  // FoundPostDTO, PostForm) -- it's only gone from the *search filter*
  // shape here.
  campus?: string;
  // Phase 28-2: admin post-management search only (src/lib/admin/posts.ts)
  // -- no public search UI exposes this. Optional/undefined for every
  // other existing caller, so this is purely additive to buildSearchWhere.
  authorQuery?: string;
  dateFrom?: Date;
  dateTo?: Date;
  // Korean status string (e.g. "찾는 중"), already validated against the
  // right board's enum by listQuerySchema's superRefine before it ever
  // reaches here -- see buildSearchWhere()'s statusMap param for how it's
  // turned into the matching Prisma enum value per board.
  status?: string;
  sort?: SortOption;
};
export type ListParams = Page & PostFilters;

export function totalPagesFor(total: number, limit: number): number {
  return Math.max(1, Math.ceil(total / limit));
}

// "내 게시물" (Phase 9) has no pagination UI, matching legacy's
// list_lost_posts_by_user()/list_found_posts_by_user() (also unpaginated)
// -- but an unbounded `findMany` is still one prolific poster away from an
// expensive query, so this caps it defensively, same spirit as
// moderation/service.ts's ADMIN_SCAN_CAP.
const MY_POSTS_CAP = 200;

// `q` matches title OR description (contains). `mode: "insensitive"` is
// required here on PostgreSQL to match the legacy behavior: SQLite's `LIKE`
// and MySQL's default collation were both case-insensitive, so a bare
// `contains` (which PostgreSQL treats case-sensitively) would silently
// regress search for any Latin-alphabet text (e.g. "AirPods" no longer
// matching "airpods") -- Prisma only supports the `mode` option against
// PostgreSQL/MongoDB, which is exactly the DB this now runs on (Phase 3).
// `category` is an exact match (matches the legacy search_lost_posts()/
// search_found_posts()'s `category = ?`); `location` is a partial match,
// since it's free text with no legacy precedent to match against.
// `dateFrom`/`dateTo` filter on `createdAt` (post registration date) rather
// than lostAt/foundAt -- those differ in meaning between the two boards and
// don't unify for `type=all`, while createdAt is the one date field with
// identical, unambiguous meaning on both, and is already what `sort` orders by.
// statusMap converts filters.status (a Korean string) to the board-specific
// Prisma enum value -- LOST_STATUS_TO_DB for LostPost queries,
// FOUND_STATUS_TO_DB for FoundPost queries. Omitted entirely by
// searchAllPosts() (type=all), which never receives a status filter in the
// first place (listQuerySchema rejects that combination -- see its
// superRefine) -- so there's no board to pick a map for there, and this
// function simply doesn't add a status clause when statusMap is absent.
// Generic over S (PrismaLostPostStatus or PrismaFoundPostStatus) so the
// returned `status` field is narrow enough to assign straight into either
// Prisma.LostPostWhereInput or Prisma.FoundPostWhereInput at the call
// site, instead of the union of both (which is assignable to neither).
function buildSearchWhere<S extends PrismaLostPostStatus | PrismaFoundPostStatus>(
  filters: PostFilters,
  statusMap?: Record<string, S>,
): {
  OR?: (
    | { title: { contains: string; mode: "insensitive" } }
    | { description: { contains: string; mode: "insensitive" } }
  )[];
  category?: string;
  // Phase 31: exact match, same as category -- campus is a fixed enum
  // (see CAMPUSES in posts/schema.ts), not free text, so there's no
  // partial/contains match to make here the way the old `location` filter
  // needed.
  campus?: string;
  user?: { nickname: { contains: string; mode: "insensitive" } };
  createdAt?: { gte?: Date; lte?: Date };
  status?: S;
} {
  const where: ReturnType<typeof buildSearchWhere<S>> = {};
  if (filters.q) {
    where.OR = [
      { title: { contains: filters.q, mode: "insensitive" } },
      { description: { contains: filters.q, mode: "insensitive" } },
    ];
  }
  if (filters.category) where.category = filters.category;
  if (filters.campus) where.campus = filters.campus;
  if (filters.authorQuery) {
    where.user = { nickname: { contains: filters.authorQuery, mode: "insensitive" } };
  }
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...(filters.dateFrom && { gte: filters.dateFrom }),
      ...(filters.dateTo && { lte: filters.dateTo }),
    };
  }
  if (filters.status && statusMap && filters.status in statusMap) {
    where.status = statusMap[filters.status];
  }
  return where;
}

function buildOrderBy(sort: SortOption = DEFAULT_SORT) {
  const direction = sort === "oldest" ? ("asc" as const) : ("desc" as const);
  return [{ createdAt: direction }, { id: direction }];
}

export function toLostPostDTO(row: {
  id: number;
  title: string;
  description: string;
  category: string;
  location: string;
  campus: string;
  status: PrismaLostPostStatus;
  imageUrl: string | null;
  lostAt: Date;
  createdAt: Date;
  updatedAt: Date;
  viewCount: number;
  user: Author;
}): LostPostDTO {
  const { user, status, ...rest } = row;
  return { type: "lost", ...rest, status: LOST_STATUS_FROM_DB[status], author: user };
}

export function toFoundPostDTO(row: {
  id: number;
  title: string;
  description: string;
  category: string;
  location: string;
  campus: string;
  status: PrismaFoundPostStatus;
  imageUrl: string | null;
  foundAt: Date;
  createdAt: Date;
  updatedAt: Date;
  viewCount: number;
  user: Author;
}): FoundPostDTO {
  const { user, status, ...rest } = row;
  return { type: "found", ...rest, status: FOUND_STATUS_FROM_DB[status], author: user };
}

// ---------- LostPost ----------

export async function listLostPosts({
  page,
  limit,
  ...filters
}: ListParams): Promise<PagedResult<LostPostDTO>> {
  const skip = (page - 1) * limit;
  const where = buildSearchWhere(filters, LOST_STATUS_TO_DB);
  const [rows, total] = await Promise.all([
    prisma.lostPost.findMany({
      where,
      orderBy: buildOrderBy(filters.sort),
      skip,
      take: limit,
      include: { user: { select: AUTHOR_SELECT } },
    }),
    prisma.lostPost.count({ where }),
  ]);
  return { items: rows.map(toLostPostDTO), page, limit, total, totalPages: totalPagesFor(total, limit) };
}

// Every LostPost owned by userId, newest first -- mirrors legacy
// list_lost_posts_by_user(). Unlike listLostPosts(), this is never
// filtered/searched (the "내 게시물" page just shows everything you own),
// and userId comes from the authenticated session server-side (see
// src/app/(main)/posts/mine/page.tsx), never from a client-supplied
// value -- so there's no risk of one user listing another's posts.
export async function listLostPostsByUser(userId: number): Promise<LostPostDTO[]> {
  const rows = await prisma.lostPost.findMany({
    where: { userId },
    orderBy: buildOrderBy(),
    take: MY_POSTS_CAP,
    include: { user: { select: AUTHOR_SELECT } },
  });
  return rows.map(toLostPostDTO);
}

export async function getLostPost(id: number): Promise<LostPostDTO | null> {
  const row = await prisma.lostPost.findUnique({
    where: { id },
    include: { user: { select: AUTHOR_SELECT } },
  });
  return row ? toLostPostDTO(row) : null;
}

export async function deleteLostPost(
  id: number,
  userId: number,
  // Phase 28-2: lets an admin delete a post they don't own (see
  // src/lib/admin/posts.ts::deletePostForAdmin) without duplicating this
  // function's delete+Storage-cleanup logic. Omitted (the default) for
  // every existing caller -- ownership is still enforced exactly as
  // before, byte-for-byte the same behavior this function already had.
  options?: { asAdmin?: boolean },
): Promise<PostMutationResult<{ id: number }>> {
  const existing = await prisma.lostPost.findUnique({ where: { id } });
  if (!existing) return { kind: "not_found" };
  if (existing.userId !== userId && !options?.asAdmin) return { kind: "forbidden", reason: "not_owner" };

  // A plain delete -- the ON DELETE CASCADE already declared on
  // ChatRoom/Message's relations (see schema.prisma) is what keeps
  // them consistent, the same way delete_lost_post() in the legacy app
  // never manually cleans up related rows either.
  await prisma.lostPost.delete({ where: { id } });
  // Best-effort: the post is already gone from the DB either way, a
  // Storage cleanup failure here is only logged, never surfaced as a
  // failed delete.
  if (existing.imageUrl) await deleteObjectSafely(existing.imageUrl);
  return { kind: "ok", data: { id } };
}

// ---------- FoundPost ----------

export async function listFoundPosts({
  page,
  limit,
  ...filters
}: ListParams): Promise<PagedResult<FoundPostDTO>> {
  const skip = (page - 1) * limit;
  const where = buildSearchWhere(filters, FOUND_STATUS_TO_DB);
  const [rows, total] = await Promise.all([
    prisma.foundPost.findMany({
      where,
      orderBy: buildOrderBy(filters.sort),
      skip,
      take: limit,
      include: { user: { select: AUTHOR_SELECT } },
    }),
    prisma.foundPost.count({ where }),
  ]);
  return { items: rows.map(toFoundPostDTO), page, limit, total, totalPages: totalPagesFor(total, limit) };
}

// Mirrors listLostPostsByUser() above -- see its comment.
export async function listFoundPostsByUser(userId: number): Promise<FoundPostDTO[]> {
  const rows = await prisma.foundPost.findMany({
    where: { userId },
    orderBy: buildOrderBy(),
    take: MY_POSTS_CAP,
    include: { user: { select: AUTHOR_SELECT } },
  });
  return rows.map(toFoundPostDTO);
}

export async function getFoundPost(id: number): Promise<FoundPostDTO | null> {
  const row = await prisma.foundPost.findUnique({
    where: { id },
    include: { user: { select: AUTHOR_SELECT } },
  });
  return row ? toFoundPostDTO(row) : null;
}

export async function deleteFoundPost(
  id: number,
  userId: number,
  // See deleteLostPost's own comment -- identical shape/reasoning.
  options?: { asAdmin?: boolean },
): Promise<PostMutationResult<{ id: number }>> {
  const existing = await prisma.foundPost.findUnique({ where: { id } });
  if (!existing) return { kind: "not_found" };
  if (existing.userId !== userId && !options?.asAdmin) return { kind: "forbidden", reason: "not_owner" };

  await prisma.foundPost.delete({ where: { id } });
  if (existing.imageUrl) await deleteObjectSafely(existing.imageUrl);
  return { kind: "ok", data: { id } };
}

// ---------- Search (type=all) ----------

// Prisma has no cross-model UNION, so a `type=all` search can't be one
// query: each table is queried independently (same where/orderBy) and the
// results are merged in memory. To keep this correct without pulling in
// entire tables, each query fetches only the rows needed to cover pages
// 1..`page` (capped at 1000 as a hard safety limit on how deep `type=all`
// pagination can go) -- bounded by page depth, not table size, but still
// more than a single page's worth per table since the merge/sort has to
// happen after both result sets are in hand. `total`/`totalPages` come
// from separate, cheap COUNT queries against each table, so those numbers
// are always exact even though the fetched rows are capped.
async function searchAllPosts({
  page,
  limit,
  ...filters
}: ListParams): Promise<PagedResult<PostDTO>> {
  // No statusMap -- listQuerySchema's superRefine rejects a status filter
  // combined with type=all, so filters.status is always undefined here;
  // <never> keeps `where.status` typed as always-undefined, which is
  // assignable to both LostPost's and FoundPost's WhereInput regardless of
  // their (different) status enum types.
  const where = buildSearchWhere<never>(filters);
  const orderBy = buildOrderBy(filters.sort);
  const depth = Math.min(page * limit, 1000);

  const [lostRows, foundRows, lostTotal, foundTotal] = await Promise.all([
    prisma.lostPost.findMany({ where, orderBy, take: depth, include: { user: { select: AUTHOR_SELECT } } }),
    prisma.foundPost.findMany({ where, orderBy, take: depth, include: { user: { select: AUTHOR_SELECT } } }),
    prisma.lostPost.count({ where }),
    prisma.foundPost.count({ where }),
  ]);

  const sortSign = filters.sort === "oldest" ? 1 : -1;
  const merged = [...lostRows.map(toLostPostDTO), ...foundRows.map(toFoundPostDTO)].sort(
    (a, b) => (a.createdAt.getTime() - b.createdAt.getTime()) * sortSign,
  );

  const skip = (page - 1) * limit;
  const total = lostTotal + foundTotal;

  return {
    items: merged.slice(skip, skip + limit),
    page,
    limit,
    total,
    totalPages: totalPagesFor(total, limit),
  };
}

// Phase H-8: same "no cross-model UNION" merge as searchAllPosts() above,
// but scoped to one user's own posts instead of search filters -- backs
// the public profile page's "작성 게시글" section (Lost+Found combined,
// newest first, paginated; PostCard's own 분실물/습득물 badge is what tells
// the two apart in the merged list, same as it already does on /search).
// Posts are hard-deleted in this app (see PublicProfileDTO.postCount's own
// comment), so a plain `where: { userId }` already excludes anything
// deleted -- no extra filtering needed. Same depth-cap safety reasoning as
// searchAllPosts(): each table query only fetches enough rows to cover
// pages 1..`page` (capped at 1000); `total`/`totalPages` still come from
// exact COUNT queries.
export async function listPostsByUser(userId: number, { page, limit }: Page): Promise<PagedResult<PostDTO>> {
  const orderBy = buildOrderBy();
  const depth = Math.min(page * limit, 1000);

  const [lostRows, foundRows, lostTotal, foundTotal] = await Promise.all([
    prisma.lostPost.findMany({
      where: { userId },
      orderBy,
      take: depth,
      include: { user: { select: AUTHOR_SELECT } },
    }),
    prisma.foundPost.findMany({
      where: { userId },
      orderBy,
      take: depth,
      include: { user: { select: AUTHOR_SELECT } },
    }),
    prisma.lostPost.count({ where: { userId } }),
    prisma.foundPost.count({ where: { userId } }),
  ]);

  const merged = [...lostRows.map(toLostPostDTO), ...foundRows.map(toFoundPostDTO)].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );

  const skip = (page - 1) * limit;
  const total = lostTotal + foundTotal;

  return {
    items: merged.slice(skip, skip + limit),
    page,
    limit,
    total,
    totalPages: totalPagesFor(total, limit),
  };
}

// Phase 21: the plain (keyword-only) dispatch -- see ./aiService.ts's own
// searchPosts() for the AI-aware superset that also handles mode=semantic.
// Every caller that imports searchPosts from *this* file (found/lost/
// search's non-semantic path, and this file's own internal callers) never
// passes mode="semantic" -- semantic mode was already routed through a
// server-side fetch to /api/posts rather than called in-process from
// those pages (Phase 13-2, see docs/AI_SEMANTIC_SEARCH_DESIGN.md), which
// kept the native onnxruntime binary and models/* files out of their
// Vercel function bundles. That fetch-based routing alone didn't keep the
// plain @huggingface/transformers *JS* import out of those bundles too,
// since searchPostsSemantic() used to live in this same file (see Phase
// 20's report) -- moving it to ./aiService.ts finishes that separation.
export async function searchPosts({
  type,
  q,
  ...params
}: ListParams & { type: PostListType }): Promise<PagedResult<PostDTO>> {
  if (type === "lost") return listLostPosts({ q, ...params });
  if (type === "found") return listFoundPosts({ q, ...params });
  return searchAllPosts({ q, ...params });
}
