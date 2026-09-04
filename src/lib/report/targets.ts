import { prisma } from "@/lib/db/prisma";

// Shared by report/service.ts (validate a new report's target) and
// moderation/service.ts (re-validate + mutate the target when a report is
// actioned) -- both need the exact same signed-id decoding legacy's
// db._validate_report_target()/apply_report_action() use, so it lives in
// one place instead of being re-implemented twice.

export type ResolvedPostTarget = { postKind: "lost" | "found"; id: number; userId: number };

// Encodes which table a post target_id refers to via its sign: positive =
// LostPost id, negative = -(FoundPost id). Used when building a report
// button for a specific post (see components/report/ReportButton usage).
export function encodePostTargetId(kind: "lost" | "found", id: number): number {
  return kind === "lost" ? id : -id;
}

export async function resolvePostTarget(targetId: number): Promise<ResolvedPostTarget | null> {
  if (targetId === 0) return null;
  if (targetId > 0) {
    const post = await prisma.lostPost.findUnique({
      where: { id: targetId },
      select: { id: true, userId: true },
    });
    return post ? { postKind: "lost", id: post.id, userId: post.userId } : null;
  }
  const post = await prisma.foundPost.findUnique({
    where: { id: -targetId },
    select: { id: true, userId: true },
  });
  return post ? { postKind: "found", id: post.id, userId: post.userId } : null;
}

export type ResolvedMessageTarget = { id: number; senderUserId: number };

export async function resolveMessageTarget(targetId: number): Promise<ResolvedMessageTarget | null> {
  return prisma.message.findUnique({ where: { id: targetId }, select: { id: true, senderUserId: true } });
}

export type ResolvedUserTarget = { id: number };

export async function resolveUserTarget(targetId: number): Promise<ResolvedUserTarget | null> {
  return prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
}
