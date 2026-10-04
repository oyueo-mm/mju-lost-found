import { ReportStatus } from "@/generated/prisma/client";

// 회원탈퇴 보유정책 -- the periods themselves, shared by the withdrawal
// (what to keep) and the daily clean-up (when it may go). See
// lib/retention/service.ts for how each is applied.
export const CHAT_TEXT_RETENTION_DAYS = 90;
export const RECORD_RETENTION_DAYS = 365;
export const ACCESS_LOG_MIN_RETENTION_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;
export const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS);

export type ReportFacts = { status: ReportStatus; processedAt: Date | null; createdAt: Date };

// Content someone reported is evidence: kept while any report on it is
// pending, then until 1 year after the last one was processed. Content
// nobody reported is not evidence.
export function evidenceReleased(reports: ReportFacts[], now: Date): boolean {
  if (reports.some((r) => r.status === ReportStatus.PENDING)) return false;
  const cutoff = daysBefore(now, RECORD_RETENTION_DAYS);
  return reports.every((r) => (r.processedAt ?? r.createdAt) <= cutoff);
}
