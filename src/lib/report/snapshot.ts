import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { CHAT_IMAGES_BUCKET, MAX_IMAGES_PER_POST, POST_IMAGES_BUCKET } from "@/lib/images/config";
import { parseChatImagePathname, parseImagePathname } from "@/lib/images/pathname";
import { pathnameFromPublicUrl } from "@/lib/images/supabaseAdmin";
import type { ReportTargetType } from "./schema";
import { copyToEvidence, evidencePathFor, removeReportEvidence } from "./evidenceStorage";


// Release C (M-1): 신고 시점 스냅샷. When a report is filed, what the reported
// content looked like is stored on the Report row (target_snapshot) and its
// images are copied into the private report-evidence bucket, so the evidence
// survives the author editing or deleting the original afterwards.
//
// - Taken inside the report's own transaction (text) and right after it
//   commits (image copies), never later -- a later read could already see
//   an edited or deleted target.
// - Admin-only: read through moderation/service.ts::getReportForAdmin
//   (reports.view); never part of the reporter-facing ReportDTO.
// - Kept while the report is pending, then until 1 year after it was
//   processed (lib/retention/policy.ts), longer while the person it is
//   about is still suspended or has an open withdrawn hold. The purge
//   removes the snapshot and its evidence objects; the report row stays.
// - Reports filed before this release have no snapshot (null); every
//   reader treats null as "only the live target is known", as before.

export const SNAPSHOT_VERSION = 1;

export type SnapshotTarget =
  | {
      kind: "post";
      postKind: "lost" | "found";
      postId: number;
      title: string;
      description: string;
      category: string;
      location: string | null;
      campus: string;
      status: string;
      authorNickname: string | null;
      createdAt: string;
      updatedAt: string;
    }
  | { kind: "message"; chatRoomId: number; content: string; senderNickname: string | null; createdAt: string; editedAt: string | null; hidden: boolean }
  | { kind: "comment"; postType: "lost" | "found"; postId: number; parentId: number | null; content: string; authorNickname: string | null; createdAt: string; updatedAt: string }
  | { kind: "thank_note"; body: string; tags: string[]; senderNickname: string | null; receiverNickname: string | null; createdAt: string }
  | { kind: "user"; nickname: string | null };

export type SnapshotImageStatus = "copied" | "failed" | "unsupported";
export type SnapshotImage = { index: number; source: "post" | "chat"; status: SnapshotImageStatus; path: string | null };

export type ReportSnapshot = {
  v: number;
  // whose content this is (author, sender, or the reported user) -- used by
  // retention to keep the evidence while that account is still sanctioned
  subjectUserId: number;
  target: SnapshotTarget;
  images: SnapshotImage[];
};

type ImageSource = { bucket: string; path: string | null };
type Captured = { snapshot: ReportSnapshot; sources: ImageSource[] };
type SnapshotTx = Pick<Prisma.TransactionClient, "lostPost" | "foundPost" | "postImage" | "message" | "comment" | "thankNote" | "user">;

const iso = (d: Date) => d.toISOString();
// Same labels as posts/service.ts (kept local so this module stays light).
const STATUS_LABEL: Record<string, string> = { SEARCHING: "찾는 중", FOUND: "찾음", KEEPING: "보관 중", COMPLETED: "완료" };

function postImageSource(url: string): ImageSource {
  const path = pathnameFromPublicUrl(url);
  // Only our own post-images objects can be copied server-side; an older
  // Vercel Blob URL is recorded as unsupported (the URL itself is not kept).
  return { bucket: POST_IMAGES_BUCKET, path: path && parseImagePathname(path) ? path : null };
}

// Reads the target as it is right now, inside the report's transaction.
// Returns null when the target is gone (the caller already validated it, so
// that only happens on a concurrent delete -- the report then simply has no
// snapshot, like an old report).
export async function captureTarget(tx: SnapshotTx, targetType: ReportTargetType, targetId: number): Promise<Captured | null> {
  if (targetType === "post") {
    const postKind = targetId > 0 ? "lost" : "found";
    const id = Math.abs(targetId);
    const post =
      postKind === "lost"
        ? await tx.lostPost.findUnique({ where: { id }, include: { user: { select: { nickname: true } } } })
        : await tx.foundPost.findUnique({ where: { id }, include: { user: { select: { nickname: true } } } });
    if (!post) return null;
    const rows = await tx.postImage.findMany({
      where: postKind === "lost" ? { lostPostId: id } : { foundPostId: id },
      orderBy: { displayOrder: "asc" },
      select: { imageUrl: true },
      take: MAX_IMAGES_PER_POST,
    });
    const urls = rows.length ? rows.map((r) => r.imageUrl) : post.imageUrl ? [post.imageUrl] : [];
    return {
      snapshot: {
        v: SNAPSHOT_VERSION,
        subjectUserId: post.userId,
        target: {
          kind: "post",
          postKind,
          postId: id,
          title: post.title,
          description: post.description,
          category: post.category,
          location: post.location,
          campus: post.campus,
          status: STATUS_LABEL[post.status] ?? String(post.status),
          authorNickname: post.user.nickname,
          createdAt: iso(post.createdAt),
          updatedAt: iso(post.updatedAt),
        },
        images: [],
      },
      sources: urls.map(postImageSource),
    };
  }

  if (targetType === "message") {
    const message = await tx.message.findUnique({ where: { id: targetId }, include: { sender: { select: { nickname: true } } } });
    if (!message) return null;
    const path = message.imagePath && parseChatImagePathname(message.imagePath)?.chatRoomId === message.chatRoomId ? message.imagePath : null;
    return {
      snapshot: {
        v: SNAPSHOT_VERSION,
        subjectUserId: message.senderUserId,
        target: {
          kind: "message",
          chatRoomId: message.chatRoomId,
          content: message.content,
          senderNickname: message.sender.nickname,
          createdAt: iso(message.createdAt),
          editedAt: message.editedAt ? iso(message.editedAt) : null,
          hidden: message.hiddenAt !== null,
        },
        images: [],
      },
      sources: message.imagePath ? [{ bucket: CHAT_IMAGES_BUCKET, path }] : [],
    };
  }

  if (targetType === "comment") {
    const comment = await tx.comment.findUnique({ where: { id: targetId }, include: { author: { select: { nickname: true } } } });
    if (!comment) return null;
    return {
      snapshot: {
        v: SNAPSHOT_VERSION,
        subjectUserId: comment.authorUserId,
        target: {
          kind: "comment",
          postType: comment.lostPostId !== null ? "lost" : "found",
          postId: (comment.lostPostId ?? comment.foundPostId)!,
          parentId: comment.parentId,
          content: comment.content,
          authorNickname: comment.author.nickname,
          createdAt: iso(comment.createdAt),
          updatedAt: iso(comment.updatedAt),
        },
        images: [],
      },
      sources: [],
    };
  }

  if (targetType === "thank_note") {
    const note = await tx.thankNote.findUnique({
      where: { id: targetId },
      include: { sender: { select: { nickname: true } }, receiver: { select: { nickname: true } } },
    });
    if (!note) return null;
    return {
      snapshot: {
        v: SNAPSHOT_VERSION,
        subjectUserId: note.senderUserId,
        target: {
          kind: "thank_note",
          body: note.body,
          tags: note.tags,
          senderNickname: note.sender.nickname,
          receiverNickname: note.receiver.nickname,
          createdAt: iso(note.createdAt),
        },
        images: [],
      },
      sources: [],
    };
  }

  const user = await tx.user.findUnique({ where: { id: targetId }, select: { id: true, nickname: true } });
  if (!user) return null;
  return { snapshot: { v: SNAPSHOT_VERSION, subjectUserId: user.id, target: { kind: "user", nickname: user.nickname }, images: [] }, sources: [] };
}

function extensionOf(path: string): string | null {
  const match = /\.(jpg|jpeg|png|webp)$/.exec(path);
  return match ? match[1] : null;
}

// Copies the captured images into report-evidence and records the outcome of
// each on the snapshot. Runs after the report committed (its id names the
// evidence folder). Never throws: a failed copy is recorded as "failed" and
// the report stands -- its text snapshot is already saved.
export async function preserveEvidenceImages(reportId: number, captured: Captured): Promise<ReportSnapshot> {
  const images: SnapshotImage[] = [];
  for (const [index, source] of captured.sources.entries()) {
    const kind = source.bucket === CHAT_IMAGES_BUCKET ? "chat" : "post";
    const ext = source.path ? extensionOf(source.path) : null;
    const dest = ext ? evidencePathFor(reportId, index, ext) : null;
    if (!source.path || !dest) {
      images.push({ index, source: kind, status: "unsupported", path: null });
      continue;
    }
    const ok = await copyToEvidence(source.bucket, source.path, dest);
    images.push({ index, source: kind, status: ok ? "copied" : "failed", path: ok ? dest : null });
  }
  const snapshot = { ...captured.snapshot, images };
  if (images.length) {
    try {
      await prisma.report.update({ where: { id: reportId }, data: { targetSnapshot: snapshot } });
    } catch (error) {
      // The copies exist but the snapshot doesn't list them: retention's
      // folder sweep (purgeReportSnapshot) still removes reports/{id}/.
      console.error("Report snapshot image update failed:", error instanceof Error ? error.name : "unknown");
    }
  }
  return snapshot;
}

// Defensive read of the stored JSON (never trusts its shape blindly).
export function readSnapshot(value: unknown): ReportSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const s = value as Partial<ReportSnapshot>;
  if (typeof s.v !== "number" || typeof s.subjectUserId !== "number" || !s.target || typeof s.target !== "object") return null;
  if (typeof (s.target as { kind?: unknown }).kind !== "string") return null;
  const images = Array.isArray(s.images) ? s.images.filter((i): i is SnapshotImage => !!i && typeof i === "object" && typeof i.index === "number") : [];
  return { v: s.v, subjectUserId: s.subjectUserId, target: s.target as SnapshotTarget, images };
}

// Retention (lib/retention/service.ts): removes a report's evidence objects,
// then its snapshot. The report row and its decision stay. If the objects
// can't be removed the snapshot is kept, so the next run tries again.
export async function purgeReportSnapshot(reportId: number, now: Date = new Date()): Promise<boolean> {
  if (!(await removeReportEvidence(reportId))) return false;
  await prisma.report.update({ where: { id: reportId }, data: { targetSnapshot: Prisma.DbNull, snapshotPurgedAt: now } });
  return true;
}
