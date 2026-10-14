import { prisma } from "@/lib/db/prisma";
import { CURRENT_IDENTITY_CONSENT_VERSION } from "@/lib/auth/terms";
import { resolveMessageTarget, resolvePostTarget, resolveUserTarget } from "@/lib/report/targets";
import type { User } from "@/generated/prisma/client";
import type { IdentityHints, IdentityValueSource } from "./googleHints";
import type { IdentityInput } from "./validation";
import { normalizeViewReason } from "./validation";

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

// The optional 실명·소속 수집·이용 동의 (가입 동의 screen or /me/identity).
export async function recordIdentityConsent(userId: number, now = new Date()): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { identityConsentVersion: CURRENT_IDENTITY_CONSENT_VERSION, identityConsentAt: now },
  });
}

// 실명·소속 동의 철회: the values are deleted and the consent cleared in one
// transaction, so sign-in stops syncing them. Posting and chatting ask for
// the consent again.
export async function withdrawIdentityConsent(userId: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.userIdentityInfo.deleteMany({ where: { userId } });
    await tx.user.update({ where: { id: userId }, data: { identityConsentVersion: null, identityConsentAt: null } });
  });
}

export type IdentitySyncResult = "created" | "updated" | "unchanged" | "skipped";

// 실명·소속 자동 수집: stores (or brings up to date) the name and affiliation
// split from the member's Google display name -- only with the current
// consent, and only when both came from an "이름/신분/소속" name of a
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

  return prisma.$transaction(async (tx) => {
    const member = await tx.user.findUnique({
      where: { id: targetUserId },
      select: {
        nickname: true,
        identityInfo: {
          select: { realName: true, department: true, realNameSource: true, departmentSource: true, updatedAt: true },
        },
      },
    });
    if (!member) return { kind: "not_found" as const };
    await tx.identityAccessLog.create({
      data: { adminUserId: admin.id, targetUserId, reportId, reason: normalizedReason },
    });
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
