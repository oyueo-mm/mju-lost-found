import type { User } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { can } from "@/lib/permissions/check";
import { CHAT_IMAGES_BUCKET, POST_IMAGES_BUCKET } from "@/lib/images/config";
import { parseChatImagePathname, parseImagePathname } from "@/lib/images/pathname";
import { copyToEvidence, evidencePathFor } from "./evidenceStorage";
import { readSnapshot } from "./snapshot";

// Retry only captured source paths, never the current target's replacement
// images. Pending-only avoids racing retention or reviving expired evidence.
export async function retryReportEvidence(admin: User, reportId: number): Promise<boolean> {
  if (!can(admin, "reports.view")) return false;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Report" WHERE id = ${reportId} FOR UPDATE`;
    const row = await tx.report.findUnique({ where: { id: reportId } });
    if (!row || row.status !== "PENDING" || row.snapshotPurgedAt) return false;
    const snapshot = readSnapshot(row.targetSnapshot);
    if (!snapshot) return false;
    for (const image of snapshot.images) {
      if (image.status !== "failed" || typeof image.retryPath !== "string") continue;
      const target = snapshot.target;
      const path = image.retryPath;
      const chat = parseChatImagePathname(path);
      const post = parseImagePathname(path);
      const allowed = image.source === "chat"
        ? target.kind === "message" && chat?.chatRoomId === target.chatRoomId
        : target.kind === "post" && post?.postType === target.postKind && post.postId === target.postId;
      const dest = evidencePathFor(reportId, image.index, path.split(".").at(-1) ?? "");
      if (!allowed || !dest) continue;
      if (await copyToEvidence(image.source === "chat" ? CHAT_IMAGES_BUCKET : POST_IMAGES_BUCKET, path, dest)) {
        image.status = "copied";
        image.path = dest;
        delete image.retryPath;
      }
    }
    await tx.report.update({ where: { id: reportId }, data: { targetSnapshot: snapshot } });
    return true;
  }, { timeout: 25000 });
}
