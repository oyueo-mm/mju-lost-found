import { prisma } from "@/lib/db/prisma";
import { CURRENT_IDENTITY_CONSENT_VERSION } from "@/lib/auth/terms";
import { encodePostTargetId, resolveMessageTarget, resolvePostTarget, resolveUserTarget } from "@/lib/report/targets";
import type { User } from "@/generated/prisma/client";
import type { IdentityHints, IdentityValueSource } from "./googleHints";
import type { IdentityInput } from "./validation";
import { normalizeViewReason } from "./validation";
import { isOperatingIdentityPurpose, type IdentityViewPurpose } from "./purposes";

// 실명·학과 (UserIdentityInfo). Every read of these values goes through
// this file: the member's own (내 정보, the form) and an admin's, for a
// report, logged. Nothing here ever logs the values themselves.

export type OwnIdentityInfo = {
  realName: string;
  department: string;
  realNameSource: string;
  departmentSource: string;
  updatedAt: Date;
  consentVersion: string;
};

export async function getOwnIdentityInfo(userId: number): Promise<OwnIdentityInfo | null> {
  return prisma.userIdentityInfo.findUnique({
    where: { userId },
    select: { realName: true, department: true, realNameSource: true, departmentSource: true, updatedAt: true, consentVersion: true },
  });
}

// Required before posting or chatting (see requireIdentityForApi): values on
// file, and the current 실명·소속 consent.
export async function hasIdentityInfo(userId: number): Promise<boolean> {
  return (
    (await prisma.userIdentityInfo.count({
      where: { userId, user: { identityConsentVersion: CURRENT_IDENTITY_CONSENT_VERSION } },
    })) > 0
  );
}

export function hasCurrentIdentityConsent(user: { identityConsentVersion: string | null }): boolean {
  return user.identityConsentVersion === CURRENT_IDENTITY_CONSENT_VERSION;
}

export type IdentitySyncResult = "created" | "updated" | "unchanged" | "skipped";

// 이름·소속 자동 수집: stores (or brings up to date) the name and affiliation
// split from the member's Google display name -- only with the current
// consent (part of the required 개인정보 동의; a member without it -- never
// given, or an earlier optional one -- is never collected), and only when both came from an "이름/신분/소속" name of a
// Workspace account (the jwt callback checks hd). Anything else is
// "skipped": nothing invented, nothing overwritten. A value the member had
// to type (source "self", no usable Google name before) is replaced once
// the Google name becomes usable. Values are never logged.
export async function syncIdentityFromHints(
  user: { id: number; identityConsentVersion: string | null },
  hints: IdentityHints | null | undefined,
  now = new Date(),
): Promise<IdentitySyncResult> {
  if (!hasCurrentIdentityConsent(user)) return "skipped";
  if (!hints?.name || !hints.department) return "skipped";
  if (hints.nameSource !== "google_display_name" || hints.departmentSource !== "google_display_name") return "skipped";

  const current = await prisma.userIdentityInfo.findUnique({
    where: { userId: user.id },
    select: { realName: true, department: true, realNameSource: true, departmentSource: true },
  });
  const data = {
    realName: hints.name,
    department: hints.department,
    realNameSource: "google_display_name",
    departmentSource: "google_display_name",
    consentVersion: CURRENT_IDENTITY_CONSENT_VERSION,
    consentedAt: now,
  };
  if (!current) {
    await prisma.userIdentityInfo.create({ data: { userId: user.id, ...data } });
    return "created";
  }
  if (
    current.realName === hints.name &&
    current.department === hints.department &&
    current.realNameSource === "google_display_name" &&
    current.departmentSource === "google_display_name"
  ) {
    return "unchanged";
  }
  await prisma.userIdentityInfo.update({ where: { userId: user.id }, data });
  return "updated";
}

// Saving the form is also the 실명·학과 수집·이용 동의 (the form's required
// checkbox), recorded with the current consent version and time -- the
// only way a Google-suggested value ever reaches the DB. `sources` says
// whether each value was kept as suggested or typed by the member.
export type IdentitySources = { realName: IdentityValueSource; department: IdentityValueSource };

export async function saveOwnIdentityInfo(
  userId: number,
  input: IdentityInput,
  sources: IdentitySources = { realName: "self", department: "self" },
  now = new Date(),
): Promise<void> {
  const data = {
    realName: input.realName,
    department: input.department,
    realNameSource: sources.realName,
    departmentSource: sources.department,
    consentVersion: CURRENT_IDENTITY_CONSENT_VERSION,
    consentedAt: now,
  };
  await prisma.userIdentityInfo.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

// The two people a report is about: who filed it, and who wrote what was
// reported (the reported member, for a USER report). Deleted comments
// still count -- a dispute can be about something already removed.
export async function reportPartyUserIds(
  reportId: number,
): Promise<{ reporterUserId: number; targetUserId: number | null } | null> {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: { reporterUserId: true, targetType: true, targetId: true },
  });
  if (!report) return null;
  let targetUserId: number | null = null;
  switch (report.targetType) {
    case "POST":
      targetUserId = (await resolvePostTarget(report.targetId))?.userId ?? null;
      break;
    case "MESSAGE":
      targetUserId = (await resolveMessageTarget(report.targetId))?.senderUserId ?? null;
      break;
    case "USER":
      targetUserId = (await resolveUserTarget(report.targetId))?.id ?? null;
      break;
    case "COMMENT":
      targetUserId =
        (await prisma.comment.findUnique({ where: { id: report.targetId }, select: { authorUserId: true } }))
          ?.authorUserId ?? null;
      break;
  }
  return { reporterUserId: report.reporterUserId, targetUserId };
}

export type AdminIdentityView = {
  nickname: string | null;
  realName: string | null;
  department: string | null;
  realNameSource: string | null;
  departmentSource: string | null;
  updatedAt: Date | null;
};

export type AdminIdentityViewResult =
  | { kind: "ok"; data: AdminIdentityView }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "invalid_reason" };

// An admin may see a member's 실명·학과 only while handling a report, only
// for that report's reporter or reported member, and only with a written
// reason. The log row is written in the same transaction as the read, so
// there is never a view without its record.
// 관리자 사용자 상세의 이름·소속 열람: the reports in which this member is
// the reporter or the reported party -- the only cases the privacy policy
// (§5) and the 이름·소속 consent let an admin view them. Each one is a
// choice for viewIdentityForReport (which re-checks the party, needs the
// reason and logs the view); nothing about the member's identity is read
// here. Newest first, at most `limit`.
export type UserReportForIdentity = {
  id: number;
  role: "신고자" | "피신고자";
  targetType: "POST" | "MESSAGE" | "USER" | "COMMENT";
  status: string;
  createdAt: Date;
};

export async function reportsInvolvingUser(
  admin: Pick<User, "isAdmin">,
  userId: number,
  limit = 30,
): Promise<UserReportForIdentity[]> {
  if (!admin.isAdmin) return [];
  const [lostPosts, foundPosts, comments, messages] = await Promise.all([
    prisma.lostPost.findMany({ where: { userId }, select: { id: true } }),
    prisma.foundPost.findMany({ where: { userId }, select: { id: true } }),
    prisma.comment.findMany({ where: { authorUserId: userId }, select: { id: true } }),
    prisma.message.findMany({ where: { senderUserId: userId }, select: { id: true } }),
  ]);
  const postTargetIds = [
    ...lostPosts.map((p) => encodePostTargetId("lost", p.id)),
    ...foundPosts.map((p) => encodePostTargetId("found", p.id)),
  ];
  const reports = await prisma.report.findMany({
    where: {
      OR: [
        { reporterUserId: userId },
        { targetType: "USER", targetId: userId },
        { targetType: "POST", targetId: { in: postTargetIds } },
        { targetType: "COMMENT", targetId: { in: comments.map((c) => c.id) } },
        { targetType: "MESSAGE", targetId: { in: messages.map((m) => m.id) } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, reporterUserId: true, targetType: true, status: true, createdAt: true },
  });
  return reports.map((r) => ({
    id: r.id,
    role: r.reporterUserId === userId ? "신고자" : "피신고자",
    targetType: r.targetType,
    status: r.status,
    createdAt: r.createdAt,
  }));
}

export async function viewIdentityForReport(
  admin: Pick<User, "id" | "isAdmin">,
  { reportId, targetUserId, reason }: { reportId: number; targetUserId: number; reason: unknown },
): Promise<AdminIdentityViewResult> {
  if (!admin.isAdmin) return { kind: "forbidden" };
  const normalizedReason = normalizeViewReason(reason);
  if (!normalizedReason) return { kind: "invalid_reason" };

  const parties = await reportPartyUserIds(reportId);
  if (!parties) return { kind: "not_found" };
  if (targetUserId !== parties.reporterUserId && targetUserId !== parties.targetUserId) return { kind: "forbidden" };

  return readIdentityAndLog({ adminUserId: admin.id, targetUserId, purpose: "report", reportId, reason: normalizedReason });
}

// 이름·소속 열람 목적 확대: a view for a stated operating purpose (분실물
// 인계 문의, 소유권 분쟁, 사칭 의심), not tied to a report. Allowed only
// for a member who agreed to the 이름·소속 consent that names these
// purposes -- CURRENT_IDENTITY_CONSENT_VERSION, which follows the policy's
// 시행일 -- so a member who has not re-consented since the change can still
// only be viewed through a report (viewIdentityForReport). Admin, purpose
// and reason are checked here, server side, and every view is logged.
export async function viewIdentityForPurpose(
  admin: Pick<User, "id" | "isAdmin">,
  { targetUserId, purpose, reason }: { targetUserId: number; purpose: unknown; reason: unknown },
): Promise<AdminIdentityViewResult | { kind: "invalid_purpose" } | { kind: "not_consented" }> {
  if (!admin.isAdmin) return { kind: "forbidden" };
  if (!isOperatingIdentityPurpose(purpose)) return { kind: "invalid_purpose" };
  const normalizedReason = normalizeViewReason(reason);
  if (!normalizedReason) return { kind: "invalid_reason" };

  const member = await prisma.user.findUnique({ where: { id: targetUserId }, select: { identityConsentVersion: true } });
  if (!member) return { kind: "not_found" };
  if (!hasCurrentIdentityConsent(member)) return { kind: "not_consented" };

  return readIdentityAndLog({ adminUserId: admin.id, targetUserId, purpose, reportId: null, reason: normalizedReason });
}

// One transaction: read the member's values and write the IdentityAccessLog
// row (admin, member, purpose, report if any, reason; the time is the row's
// own default) -- a view is never shown without its log entry.
async function readIdentityAndLog(log: {
  adminUserId: number;
  targetUserId: number;
  purpose: IdentityViewPurpose;
  reportId: number | null;
  reason: string;
}): Promise<AdminIdentityViewResult> {
  return prisma.$transaction(async (tx) => {
    const member = await tx.user.findUnique({
      where: { id: log.targetUserId },
      select: {
        nickname: true,
        identityInfo: {
          select: { realName: true, department: true, realNameSource: true, departmentSource: true, updatedAt: true },
        },
      },
    });
    if (!member) return { kind: "not_found" as const };
    await tx.identityAccessLog.create({ data: log });
    return {
      kind: "ok" as const,
      data: {
        nickname: member.nickname,
        realName: member.identityInfo?.realName ?? null,
        department: member.identityInfo?.department ?? null,
        realNameSource: member.identityInfo?.realNameSource ?? null,
        departmentSource: member.identityInfo?.departmentSource ?? null,
        updatedAt: member.identityInfo?.updatedAt ?? null,
      },
    };
  });
}

// Whether the member agreed to the consent that names the operating
// purposes (the admin user detail page greys them out otherwise; the
// server check is viewIdentityForPurpose's).
export async function identityConsentCoversOperatingPurposes(admin: Pick<User, "isAdmin">, userId: number): Promise<boolean> {
  if (!admin.isAdmin) return false;
  const member = await prisma.user.findUnique({ where: { id: userId }, select: { identityConsentVersion: true } });
  return member ? hasCurrentIdentityConsent(member) : false;
}

// The member's most recent 이름·소속 views (who, why, when) for the admin
// user detail page -- the log itself, never the values.
export type IdentityViewLogEntry = {
  id: number;
  adminNickname: string | null;
  purpose: string;
  reportId: number | null;
  reason: string;
  accessedAt: Date;
};

export async function recentIdentityViews(
  admin: Pick<User, "isAdmin">,
  targetUserId: number,
  limit = 10,
): Promise<IdentityViewLogEntry[]> {
  if (!admin.isAdmin) return [];
  const rows = await prisma.identityAccessLog.findMany({
    where: { targetUserId },
    orderBy: { accessedAt: "desc" },
    take: limit,
    select: { id: true, purpose: true, reportId: true, reason: true, accessedAt: true, admin: { select: { nickname: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    adminNickname: r.admin.nickname,
    purpose: r.purpose,
    reportId: r.reportId,
    reason: r.reason,
    accessedAt: r.accessedAt,
  }));
}
