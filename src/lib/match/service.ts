import { prisma } from "@/lib/db/prisma";
import { isCurrentlySuspended } from "@/lib/auth/suspension";
import { NotificationType, Prisma, type User } from "@/generated/prisma/client";
import type { PostType } from "@/lib/posts/schema";
import type { CreateMatchInput } from "./schema";

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
