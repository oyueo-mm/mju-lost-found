import { prisma } from "@/lib/db/prisma";
import type { User } from "@/generated/prisma/client";
import { can } from "@/lib/permissions/check";
import { signEvidenceUrl } from "./evidenceStorage";
import { readSnapshot, type ReportSnapshot } from "./snapshot";

export type EvidenceImageView = { index: number; source: "post" | "chat"; status: "copied" | "failed" | "unsupported"; url: string | null };

// Release C (M-1): short-lived signed URLs for one report's evidence images,
// for the admin report page. Re-checks reports.view itself; reads the
// snapshot from the DB by report id (never a client-supplied path). A chat
// image is a private message, so handing it out is logged exactly like the
// live one is (AdminAccessLog, resource "chat_image" -- the same allowed
// value, adminaccesslog_resource_check -- with this report and message).
export async function getReportEvidenceImages(admin: User, reportId: number): Promise<EvidenceImageView[] | null> {
  if (!can(admin, "reports.view")) return null;
  const row = await prisma.report.findUnique({ where: { id: reportId }, select: { targetId: true, targetSnapshot: true } });
  if (!row) return null;
  const snapshot: ReportSnapshot | null = readSnapshot(row.targetSnapshot);
  if (!snapshot) return [];
  const views: EvidenceImageView[] = [];
  let loggedChat = false;
  for (const image of snapshot.images) {
    const url = image.status === "copied" && image.path ? await signEvidenceUrl(image.path) : null;
    if (url && image.source === "chat" && snapshot.target.kind === "message" && !loggedChat) {
      await prisma.adminAccessLog.create({
        data: { adminUserId: admin.id, resource: "chat_image", chatRoomId: snapshot.target.chatRoomId, messageId: row.targetId, reportId },
      });
      loggedChat = true;
    }
    views.push({ index: image.index, source: image.source, status: image.status, url });
  }
  return views;
}
