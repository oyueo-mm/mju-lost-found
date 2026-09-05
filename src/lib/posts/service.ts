import { prisma } from "@/lib/db/prisma";
import { isCurrentlySuspended } from "@/lib/auth/suspension";
import { deleteBlobSafely } from "@/lib/images/blob";
import {
  FoundPostStatus as PrismaFoundPostStatus,
  LostPostStatus as PrismaLostPostStatus,
  type User,
} from "@/generated/prisma/client";
import type {
  CreateFoundPostInput,
  CreateLostPostInput,
  PostListType,
  SortOption,
  UpdateFoundPostInput,
  UpdateLostPostInput,
} from "./schema";
import { DEFAULT_SORT } from "./schema";

// The Prisma Client's generated enum types use the ASCII identifiers
// (SEARCHING/FOUND, ...) as their actual TS/JS values -- @map in
// schema.prisma only renames the value stored in the DB column, it
// doesn't change what the generated client accepts/returns. The rest of
// this app (zod schemas, the API, the UI) speaks the real legacy Korean
// values, so every DB read/write through this service converts here, in
// one place, rather than leaking the Prisma-internal identifiers upward.
const LOST_STATUS_TO_DB: Record<string, PrismaLostPostStatus> = {
  "찾는 중": PrismaLostPostStatus.SEARCHING,
  "찾음": PrismaLostPostStatus.FOUND,
};
const LOST_STATUS_FROM_DB: Record<PrismaLostPostStatus, string> = {
  SEARCHING: "찾는 중",
  FOUND: "찾음",
};
const FOUND_STATUS_TO_DB: Record<string, PrismaFoundPostStatus> = {
  "보관 중": PrismaFoundPostStatus.KEEPING,
  "완료": PrismaFoundPostStatus.COMPLETED,
};
const FOUND_STATUS_FROM_DB: Record<PrismaFoundPostStatus, string> = {
  KEEPING: "보관 중",
  COMPLETED: "완료",
};

// Only ever the two fields the legacy UI treats as public identity (see
// ui/auth.py: "nickname is the only identity shown publicly") -- never
// email, isAdmin, isSuspended, etc, regardless of how much of `User` a
// caller might otherwise have access to.
const AUTHOR_SELECT = { id: true, nickname: true } as const;
type Author = { id: number; nickname: string | null };

export type LostPostDTO = {
  id: number;
  type: "lost";
  title: string;
  description: string;
  category: string;
  location: string;
  status: string;
  imageUrl: string | null;
  lostAt: Date;
  createdAt: Date;
  updatedAt: Date;
  author: Author;
};

export type FoundPostDTO = {
  id: number;
  type: "found";
  title: string;
  description: string;
  category: string;
  location: string;
  status: string;
  imageUrl: string | null;
  foundAt: Date;
  createdAt: Date;
  updatedAt: Date;
  author: Author;
};

export type PostDTO = LostPostDTO | FoundPostDTO;

export type PostMutationResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "not_found" }
  | { kind: "forbidden"; reason: "not_owner" | "suspended" };

type Page = { page: number; limit: number };
type PagedResult<T> = {
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
  location?: string;
  dateFrom?: Date;
  dateTo?: Date;
  sort?: SortOption;
};
type ListParams = Page & PostFilters;

function totalPagesFor(total: number, limit: number): number {
  return Math.max(1, Math.ceil(total / limit));
}

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
function buildSearchWhere(filters: PostFilters): {
  OR?: (
    | { title: { contains: string; mode: "insensitive" } }
    | { description: { contains: string; mode: "insensitive" } }
  )[];
  category?: string;
  location?: { contains: string; mode: "insensitive" };
  createdAt?: { gte?: Date; lte?: Date };
} {
  const where: ReturnType<typeof buildSearchWhere> = {};
  if (filters.q) {
    where.OR = [
      { title: { contains: filters.q, mode: "insensitive" } },
      { description: { contains: filters.q, mode: "insensitive" } },
    ];
  }
  if (filters.category) where.category = filters.category;
  if (filters.location) where.location = { contains: filters.location, mode: "insensitive" };
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...(filters.dateFrom && { gte: filters.dateFrom }),
      ...(filters.dateTo && { lte: filters.dateTo }),
    };
  }
  return where;
}

function buildOrderBy(sort: SortOption = DEFAULT_SORT) {
  const direction = sort === "oldest" ? ("asc" as const) : ("desc" as const);
  return [{ createdAt: direction }, { id: direction }];
}

function toLostPostDTO(row: {
  id: number;
  title: string;
  description: string;
  category: string;
  location: string;
  status: PrismaLostPostStatus;
  imageUrl: string | null;
  lostAt: Date;
  createdAt: Date;
  updatedAt: Date;
  user: Author;
}): LostPostDTO {
  const { user, status, ...rest } = row;
  return { type: "lost", ...rest, status: LOST_STATUS_FROM_DB[status], author: user };
}

function toFoundPostDTO(row: {
  id: number;
  title: string;
  description: string;
  category: string;
  location: string;
  status: PrismaFoundPostStatus;
  imageUrl: string | null;
  foundAt: Date;
  createdAt: Date;
  updatedAt: Date;
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
  const where = buildSearchWhere(filters);
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

export async function getLostPost(id: number): Promise<LostPostDTO | null> {
  const row = await prisma.lostPost.findUnique({
    where: { id },
    include: { user: { select: AUTHOR_SELECT } },
  });
  return row ? toLostPostDTO(row) : null;
}

export async function createLostPost(
  author: User,
  input: CreateLostPostInput,
): Promise<PostMutationResult<LostPostDTO>> {
  if (isCurrentlySuspended(author)) {
    return { kind: "forbidden", reason: "suspended" };
  }
  const { status, ...rest } = input;
  const row = await prisma.lostPost.create({
    data: {
      ...rest,
      userId: author.id,
      ...(status !== undefined && { status: LOST_STATUS_TO_DB[status] }),
    },
    include: { user: { select: AUTHOR_SELECT } },
  });
  return { kind: "ok", data: toLostPostDTO(row) };
}

export async function updateLostPost(
  id: number,
  userId: number,
  input: UpdateLostPostInput,
): Promise<PostMutationResult<LostPostDTO>> {
  const existing = await prisma.lostPost.findUnique({ where: { id } });
  if (!existing) return { kind: "not_found" };
  if (existing.userId !== userId) return { kind: "forbidden", reason: "not_owner" };

  const { status, ...rest } = input;
  const row = await prisma.lostPost.update({
    where: { id },
    data: {
      ...rest,
      ...(status !== undefined && { status: LOST_STATUS_TO_DB[status] }),
    },
    include: { user: { select: AUTHOR_SELECT } },
  });
  return { kind: "ok", data: toLostPostDTO(row) };
}

export async function deleteLostPost(
  id: number,
  userId: number,
): Promise<PostMutationResult<{ id: number }>> {
  const existing = await prisma.lostPost.findUnique({ where: { id } });
  if (!existing) return { kind: "not_found" };
  if (existing.userId !== userId) return { kind: "forbidden", reason: "not_owner" };

  // A plain delete -- Match/ChatRoom/Message aren't implemented yet, but
  // the ON DELETE CASCADE already declared on those relations (see
  // schema.prisma) is what's meant to keep them consistent once they
  // exist, the same way delete_lost_post() in the legacy app never
  // manually cleans up related rows either.
  await prisma.lostPost.delete({ where: { id } });
  // Best-effort: the post is already gone from the DB either way, a Blob
  // cleanup failure here is only logged, never surfaced as a failed delete.
  if (existing.imageUrl) await deleteBlobSafely(existing.imageUrl);
  return { kind: "ok", data: { id } };
}

// ---------- FoundPost ----------

export async function listFoundPosts({
  page,
  limit,
  ...filters
}: ListParams): Promise<PagedResult<FoundPostDTO>> {
  const skip = (page - 1) * limit;
  const where = buildSearchWhere(filters);
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

export async function getFoundPost(id: number): Promise<FoundPostDTO | null> {
  const row = await prisma.foundPost.findUnique({
    where: { id },
    include: { user: { select: AUTHOR_SELECT } },
  });
  return row ? toFoundPostDTO(row) : null;
}

export async function createFoundPost(
  author: User,
  input: CreateFoundPostInput,
): Promise<PostMutationResult<FoundPostDTO>> {
  if (isCurrentlySuspended(author)) {
    return { kind: "forbidden", reason: "suspended" };
  }
  const { status, ...rest } = input;
  const row = await prisma.foundPost.create({
    data: {
      ...rest,
      userId: author.id,
      ...(status !== undefined && { status: FOUND_STATUS_TO_DB[status] }),
    },
    include: { user: { select: AUTHOR_SELECT } },
  });
  return { kind: "ok", data: toFoundPostDTO(row) };
}

export async function updateFoundPost(
  id: number,
  userId: number,
  input: UpdateFoundPostInput,
): Promise<PostMutationResult<FoundPostDTO>> {
  const existing = await prisma.foundPost.findUnique({ where: { id } });
  if (!existing) return { kind: "not_found" };
  if (existing.userId !== userId) return { kind: "forbidden", reason: "not_owner" };

  const { status, ...rest } = input;
  const row = await prisma.foundPost.update({
    where: { id },
    data: {
      ...rest,
      ...(status !== undefined && { status: FOUND_STATUS_TO_DB[status] }),
    },
    include: { user: { select: AUTHOR_SELECT } },
  });
  return { kind: "ok", data: toFoundPostDTO(row) };
}

export async function deleteFoundPost(
  id: number,
  userId: number,
): Promise<PostMutationResult<{ id: number }>> {
  const existing = await prisma.foundPost.findUnique({ where: { id } });
  if (!existing) return { kind: "not_found" };
  if (existing.userId !== userId) return { kind: "forbidden", reason: "not_owner" };

  await prisma.foundPost.delete({ where: { id } });
  if (existing.imageUrl) await deleteBlobSafely(existing.imageUrl);
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
  const where = buildSearchWhere(filters);
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

// The single entry point /api/posts (and /search) call: dispatches to the
// per-board listers for type=lost/found, or the merged search above for
// type=all.
export async function searchPosts({
  type,
  ...params
}: ListParams & { type: PostListType }): Promise<PagedResult<PostDTO>> {
  if (type === "lost") return listLostPosts(params);
  if (type === "found") return listFoundPosts(params);
  return searchAllPosts(params);
}
