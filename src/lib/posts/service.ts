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
  UpdateFoundPostInput,
  UpdateLostPostInput,
} from "./schema";

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
type PagedResult<T> = { items: T[]; page: number; limit: number; total: number };

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

export async function listLostPosts({ page, limit }: Page): Promise<PagedResult<LostPostDTO>> {
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    prisma.lostPost.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: limit,
      include: { user: { select: AUTHOR_SELECT } },
    }),
    prisma.lostPost.count(),
  ]);
  return { items: rows.map(toLostPostDTO), page, limit, total };
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

export async function listFoundPosts({ page, limit }: Page): Promise<PagedResult<FoundPostDTO>> {
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    prisma.foundPost.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: limit,
      include: { user: { select: AUTHOR_SELECT } },
    }),
    prisma.foundPost.count(),
  ]);
  return { items: rows.map(toFoundPostDTO), page, limit, total };
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
