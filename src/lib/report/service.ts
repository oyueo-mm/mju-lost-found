import { prisma } from "@/lib/db/prisma";
import {
  Prisma,
  ReportTargetType as PrismaReportTargetType,
  ReportStatus as PrismaReportStatus,
  type Report,
  type User,
} from "@/generated/prisma/client";
import type { CreateReportInput, ReportStatusValue, ReportTargetType } from "./schema";
import { resolveMessageTarget, resolvePostTarget, resolveUserTarget } from "./targets";

// Prisma's generated enum values are the ASCII identifiers (POST, MESSAGE,
// USER / PENDING, DISMISSED, ACTIONED) -- @map only renames the DB column
// value. Every Report is exposed using the legacy's actual lowercase
// string values, same convention as notification/service.ts's
// NOTIFICATION_TYPE_FROM_DB.
export const TARGET_TYPE_TO_DB: Record<ReportTargetType, PrismaReportTargetType> = {
  post: PrismaReportTargetType.POST,
  message: PrismaReportTargetType.MESSAGE,
  user: PrismaReportTargetType.USER,
};
export const TARGET_TYPE_FROM_DB: Record<PrismaReportTargetType, ReportTargetType> = {
  POST: "post",
  MESSAGE: "message",
  USER: "user",
};
export const STATUS_FROM_DB: Record<PrismaReportStatus, ReportStatusValue> = {
  PENDING: "pending",
  DISMISSED: "dismissed",
  ACTIONED: "actioned",
};

export type ReportDTO = {
  id: number;
  targetType: ReportTargetType;
  targetId: number;
  reason: string;
  detail: string | null;
  status: ReportStatusValue;
  createdAt: Date;
  processedAt: Date | null;
  adminNote: string | null;
};

export function toReportDTO(row: Report): ReportDTO {
  return {
    id: row.id,
    targetType: TARGET_TYPE_FROM_DB[row.targetType],
    targetId: row.targetId,
    reason: row.reason,
    detail: row.detail,
    status: STATUS_FROM_DB[row.status],
    createdAt: row.createdAt,
    processedAt: row.processedAt,
    adminNote: row.adminNote,
  };
}

export type CreateReportResult =
  | { kind: "ok"; data: ReportDTO }
  | { kind: "target_not_found" }
  | { kind: "self_report" }
  | { kind: "duplicate" };

// Mirrors legacy db.create_report(): validates the target exists and
// rejects self-reports (own post, own message, or yourself) before ever
// touching the Report table. Duplicate reports (same reporter + same
// target) are rejected via the UNIQUE(reporterUserId, targetType,
// targetId) constraint itself -- the source of truth, not a
// SELECT-then-INSERT precheck -- so a race between two identical requests
// from the same user still can't create two rows.
export async function createReport(reporter: User, input: CreateReportInput): Promise<CreateReportResult> {
  if (input.targetType === "post") {
    const target = await resolvePostTarget(input.targetId);
    if (!target) return { kind: "target_not_found" };
    if (target.userId === reporter.id) return { kind: "self_report" };
  } else if (input.targetType === "message") {
    const target = await resolveMessageTarget(input.targetId);
    if (!target) return { kind: "target_not_found" };
    if (target.senderUserId === reporter.id) return { kind: "self_report" };
  } else {
    const target = await resolveUserTarget(input.targetId);
    if (!target) return { kind: "target_not_found" };
    if (target.id === reporter.id) return { kind: "self_report" };
  }

  try {
    const created = await prisma.report.create({
      data: {
        reporterUserId: reporter.id,
        targetType: TARGET_TYPE_TO_DB[input.targetType],
        targetId: input.targetId,
        reason: input.reason,
        detail: input.detail ?? null,
      },
    });
    return { kind: "ok", data: toReportDTO(created) };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { kind: "duplicate" };
    }
    throw error;
  }
}

export type ReportLookupResult =
  | { kind: "ok"; data: ReportDTO }
  | { kind: "not_found" }
  | { kind: "forbidden" };

// A regular user may only ever see their own filed reports -- there is no
// "view any report" ability for non-admins in the legacy app either
// (list_reports_by_reporter is always scoped to the caller's own id).
export async function getReportForUser(id: number, requesterId: number): Promise<ReportLookupResult> {
  const report = await prisma.report.findUnique({ where: { id } });
  if (!report) return { kind: "not_found" };
  if (report.reporterUserId !== requesterId) return { kind: "forbidden" };
  return { kind: "ok", data: toReportDTO(report) };
}

// Mirrors legacy list_reports_by_reporter(): every report the user has
// filed, newest first, no pagination (matches legacy exactly -- a single
// user's own report history is never large enough to need it).
export async function listReportsForUser(reporterUserId: number): Promise<ReportDTO[]> {
  const rows = await prisma.report.findMany({
    where: { reporterUserId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toReportDTO);
}
