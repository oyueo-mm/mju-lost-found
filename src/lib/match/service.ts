import { prisma } from "@/lib/db/prisma";
import { isCurrentlySuspended } from "@/lib/auth/suspension";
import {
  NotificationType,
  Prisma,
  type FoundPostStatus as PrismaFoundPostStatus,
  type LostPostStatus as PrismaLostPostStatus,
  type User,
} from "@/generated/prisma/client";
import type { PostType } from "@/lib/posts/schema";
import type { CreateMatchInput } from "./schema";

// Same duplication tradeoff as moderation/service.ts's own
// LOST_STATUS_FROM_DB/FOUND_STATUS_FROM_DB (which cites this exact
// reasoning): posts/service.ts already has this mapping but doesn't
// export it, and this module only needs it for a read-only summary
// display -- not worth widening posts/service.ts's public surface for a
// two-entry lookup table.
const LOST_STATUS_FROM_DB: Record<PrismaLostPostStatus, string> = {
  SEARCHING: "찾는 중",
  FOUND: "찾음",
};
const FOUND_STATUS_FROM_DB: Record<PrismaFoundPostStatus, string> = {
  KEEPING: "보관 중",
  COMPLETED: "완료",
};

// Deliberately minimal -- just enough to identify and display the
// counterpart post, never the full LostPost/FoundPostDTO (author email
// etc. has no business being in a match listing).
type PostSummary = { id: number; title: string; imageUrl: string | null };

export type MatchDTO = {
  id: number;
  score: number;
  createdAt: Date;
  lostPost: PostSummary;
  foundPost: PostSummary;
};

export type MatchMutationResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "lost_not_found" }
  | { kind: "found_not_found" }
  | { kind: "not_found" }
  | { kind: "forbidden"; reason: "not_owner" | "suspended" };

const POST_SUMMARY_SELECT = { id: true, title: true, imageUrl: true } as const;

function toMatchDTO(row: {
  id: number;
  score: number;
  createdAt: Date;
  lostPost: PostSummary;
  foundPost: PostSummary;
}): MatchDTO {
  return row;
}

// Mirrors the legacy db.create_match(): requester must own the LostPost OR
// the FoundPost side (either can confirm a match from their own post) --
// not both. Idempotent by design (same as legacy, matching the
// UNIQUE(lostPostId, foundPostId) constraint already in schema.prisma):
// re-requesting an already-matched pair returns the existing Match rather
// than erroring, so this is not a "duplicate -> 4xx" endpoint on purpose.
export async function createMatch(
  requester: User,
  input: CreateMatchInput,
): Promise<MatchMutationResult<MatchDTO>> {
  if (isCurrentlySuspended(requester)) {
    return { kind: "forbidden", reason: "suspended" };
  }

  const [lostPost, foundPost] = await Promise.all([
    prisma.lostPost.findUnique({ where: { id: input.lostPostId }, select: { id: true, userId: true } }),
    prisma.foundPost.findUnique({ where: { id: input.foundPostId }, select: { id: true, userId: true } }),
  ]);
  if (!lostPost) return { kind: "lost_not_found" };
  if (!foundPost) return { kind: "found_not_found" };
  if (requester.id !== lostPost.userId && requester.id !== foundPost.userId) {
    return { kind: "forbidden", reason: "not_owner" };
  }

  const existing = await prisma.match.findUnique({
    where: { lostPostId_foundPostId: { lostPostId: input.lostPostId, foundPostId: input.foundPostId } },
    include: { lostPost: { select: POST_SUMMARY_SELECT }, foundPost: { select: POST_SUMMARY_SELECT } },
  });
  if (existing) return { kind: "ok", data: toMatchDTO(existing) };

  try {
    const created = await prisma.$transaction(async (tx) => {
      const match = await tx.match.create({
        data: {
          lostPostId: input.lostPostId,
          foundPostId: input.foundPostId,
          score: input.score ?? 1,
        },
        include: { lostPost: { select: POST_SUMMARY_SELECT }, foundPost: { select: POST_SUMMARY_SELECT } },
      });

      // One notification per distinct participant -- a user who owns both
      // sides (matching their own lost item to their own found item)
      // gets just one, same as the legacy `set` dedup.
      const participantIds = new Set([lostPost.userId, foundPost.userId]);
      for (const userId of participantIds) {
        await tx.notification.create({
          data: {
            userId,
            type: NotificationType.MATCH,
            title: "새로운 매칭이 성립되었습니다",
            content: "매칭이 확정되어 상대방과 연락할 수 있습니다.",
            relatedType: "match",
            relatedId: match.id,
          },
        });
      }

      return match;
    });
    return { kind: "ok", data: toMatchDTO(created) };
  } catch (error) {
    // Two concurrent requests for the same pair both pass the findUnique
    // check above, then race on the INSERT -- the UNIQUE constraint lets
    // exactly one through and the other hits P2002. Re-fetch and return
    // the winner instead of erroring, same as legacy's
    // "except sqlite3.IntegrityError: re-fetch" fallback.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await prisma.match.findUnique({
        where: { lostPostId_foundPostId: { lostPostId: input.lostPostId, foundPostId: input.foundPostId } },
        include: { lostPost: { select: POST_SUMMARY_SELECT }, foundPost: { select: POST_SUMMARY_SELECT } },
      });
      if (winner) return { kind: "ok", data: toMatchDTO(winner) };
    }
    throw error;
  }
}

async function findMatchWithOwners(id: number) {
  return prisma.match.findUnique({
    where: { id },
    include: {
      lostPost: { select: { ...POST_SUMMARY_SELECT, userId: true } },
      foundPost: { select: { ...POST_SUMMARY_SELECT, userId: true } },
    },
  });
}

export async function getMatch(id: number): Promise<MatchDTO | null> {
  const row = await findMatchWithOwners(id);
  return row ? toMatchDTO(row) : null;
}

// Matches involving one specific post -- requires the requester to own
// that post (this is the only way a match ever exposes who it's paired
// with, so it must not be open to arbitrary viewers). Ordered by score
// desc, same as the legacy list_matches_for_lost_post/found_post.
export async function listMatchesForPost(
  type: PostType,
  postId: number,
  requesterId: number,
): Promise<MatchMutationResult<MatchDTO[]>> {
  const post =
    type === "lost"
      ? await prisma.lostPost.findUnique({ where: { id: postId }, select: { userId: true } })
      : await prisma.foundPost.findUnique({ where: { id: postId }, select: { userId: true } });
  if (!post) return { kind: type === "lost" ? "lost_not_found" : "found_not_found" };
  if (post.userId !== requesterId) return { kind: "forbidden", reason: "not_owner" };

  const rows = await prisma.match.findMany({
    where: type === "lost" ? { lostPostId: postId } : { foundPostId: postId },
    orderBy: { score: "desc" },
    include: { lostPost: { select: POST_SUMMARY_SELECT }, foundPost: { select: POST_SUMMARY_SELECT } },
  });
  return { kind: "ok", data: rows.map(toMatchDTO) };
}

// Every match where the current user owns either side -- mirrors legacy
// list_matches_by_user(), minus the unread-chat-count join (chat isn't
// implemented yet).
export async function listMatchesForUser(userId: number): Promise<MatchDTO[]> {
  const rows = await prisma.match.findMany({
    where: { OR: [{ lostPost: { userId } }, { foundPost: { userId } }] },
    orderBy: { createdAt: "desc" },
    include: { lostPost: { select: POST_SUMMARY_SELECT }, foundPost: { select: POST_SUMMARY_SELECT } },
  });
  return rows.map(toMatchDTO);
}

// Mirrors legacy db.delete_match(): only cancels the Match row, never
// touches the LostPost/FoundPost themselves. Same either-side ownership
// rule as createMatch().
export async function deleteMatch(
  id: number,
  requesterId: number,
): Promise<MatchMutationResult<{ id: number }>> {
  const match = await findMatchWithOwners(id);
  if (!match) return { kind: "not_found" };
  if (requesterId !== match.lostPost.userId && requesterId !== match.foundPost.userId) {
    return { kind: "forbidden", reason: "not_owner" };
  }

  await prisma.match.delete({ where: { id } });
  return { kind: "ok", data: { id } };
}

// Resolves which of a match's two posts belongs to userId -- used only by
// the notifications page to build a "관련 게시물로 이동" link for a
// type=match notification's relatedId (see Phase 9). This is a one-way
// read from notifications -> match, never the other way around: the
// notification service itself (src/lib/notification/service.ts) has no
// dependency on this or any other domain, and this function has no
// dependency on the notification domain either. Returns null if the
// match no longer exists or userId isn't actually party to it (e.g. the
// notification is stale) -- callers should just omit the link, not treat
// it as an error.
export async function getOwnedPostRefForMatch(
  matchId: number,
  userId: number,
): Promise<{ id: number; type: PostType } | null> {
  const match = await findMatchWithOwners(matchId);
  if (!match) return null;
  if (match.lostPost.userId === userId) return { id: match.lostPost.id, type: "lost" };
  if (match.foundPost.userId === userId) return { id: match.foundPost.id, type: "found" };
  return null;
}

// Phase 11: "내 매칭" (/matches) summary -- every Match this user is party
// to, pre-oriented relative to them (myPost vs counterpartPost) so the
// page never has to compute that itself. Reuses exactly the same
// ownership WHERE clause as listMatchesForUser() above; this is *not* a
// replacement for that function (MatchPanel and other existing callers
// keep using the fixed lostPost/foundPost shape unchanged) -- a separate,
// additive function for this one new page.
//
// Note on "Match 상태": the Match model itself has no status enum (see
// schema.prisma) -- a Match row's mere existence already means confirmed
// (there is no "pending" match state anywhere in this app; AI candidates
// are never persisted, only a user-confirmed pairing becomes a row, and
// "취소" deletes the row rather than changing a status). So there is no
// real per-Match status to display, and this deliberately does not invent
// one. What *does* vary, and is real schema data, is each side's own post
// status (LostPostStatus/FoundPostStatus) -- included here for that
// reason, translated through the same private maps posts/service.ts uses
// internally.
export type MyMatchSummaryDTO = {
  id: number;
  score: number;
  createdAt: Date;
  myPost: { id: number; type: PostType; title: string; status: string };
  counterpartPost: { id: number; type: PostType; title: string; status: string; imageUrl: string | null };
  // Same minimal shape as ChatRoomDetailDTO's counterpart (id + nickname
  // only, never email) -- this project's established safe shape for
  // showing who's on the other side of an interaction.
  counterpart: { id: number; nickname: string | null };
};

const MATCH_SUMMARY_POST_SELECT = { id: true, userId: true, title: true, imageUrl: true, status: true } as const;

export async function listMyMatchesSummary(userId: number): Promise<MyMatchSummaryDTO[]> {
  const rows = await prisma.match.findMany({
    where: { OR: [{ lostPost: { userId } }, { foundPost: { userId } }] },
    orderBy: { createdAt: "desc" },
    include: {
      lostPost: { select: MATCH_SUMMARY_POST_SELECT },
      foundPost: { select: MATCH_SUMMARY_POST_SELECT },
    },
  });
  if (rows.length === 0) return [];

  // One batched lookup for every counterpart's nickname, instead of one
  // query per row.
  const counterpartIds = new Set(
    rows.map((row) => (row.lostPost.userId === userId ? row.foundPost.userId : row.lostPost.userId)),
  );
  const counterpartUsers = await prisma.user.findMany({
    where: { id: { in: [...counterpartIds] } },
    select: { id: true, nickname: true },
  });
  const counterpartById = new Map(counterpartUsers.map((u) => [u.id, u]));

  return rows.map((row) => {
    const isLostMine = row.lostPost.userId === userId;
    const mine = isLostMine ? row.lostPost : row.foundPost;
    const counterpartPost = isLostMine ? row.foundPost : row.lostPost;
    const counterpartUser = counterpartById.get(counterpartPost.userId) ?? {
      id: counterpartPost.userId,
      nickname: null,
    };

    return {
      id: row.id,
      score: row.score,
      createdAt: row.createdAt,
      myPost: {
        id: mine.id,
        type: isLostMine ? "lost" : "found",
        title: mine.title,
        status: isLostMine
          ? LOST_STATUS_FROM_DB[mine.status as PrismaLostPostStatus]
          : FOUND_STATUS_FROM_DB[mine.status as PrismaFoundPostStatus],
      },
      counterpartPost: {
        id: counterpartPost.id,
        type: isLostMine ? "found" : "lost",
        title: counterpartPost.title,
        status: isLostMine
          ? FOUND_STATUS_FROM_DB[counterpartPost.status as PrismaFoundPostStatus]
          : LOST_STATUS_FROM_DB[counterpartPost.status as PrismaLostPostStatus],
        imageUrl: counterpartPost.imageUrl,
      },
      counterpart: counterpartUser,
    };
  });
}
