import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";

// 관리자 활동 (운영 통계 > 관리자 활동). The tab reads the records the app
// already keeps with an admin and a time (reports processed, sanctions,
// approval requests, reviews, view logs ...; see metrics/adminActivity.ts).
// AdminActivityLog adds only the completed tasks that left no such trace:
// the keys below, each written by its caller after the task succeeded.
// Never a page view or a click, never content -- the key and the target's id.

export type AdminTaskCategory = "report" | "content" | "sanction" | "role" | "review" | "operations" | "access";

export const ADMIN_TASK_CATEGORIES: { key: AdminTaskCategory; label: string }[] = [
  { key: "report", label: "신고 처리" },
  { key: "content", label: "게시물·댓글 조치" },
  { key: "sanction", label: "이용 제한·해제" },
  { key: "role", label: "관리자 권한 변경" },
  { key: "review", label: "재가입·단체 심사" },
  { key: "operations", label: "공지·운영 관리" },
  { key: "access", label: "대화·실명 열람" },
];

export const ADMIN_ACTIVITY_ACTIONS = {
  "post.delete": { label: "게시글 직접 삭제", category: "content" },
  "user.unsuspend": { label: "이용 제한 해제", category: "sanction" },
  "announcement.update": { label: "공지 수정", category: "operations" },
  "announcement.delete": { label: "공지 삭제", category: "operations" },
  "feedback.status": { label: "문의·의견 상태 변경", category: "operations" },
  "organization.status": { label: "단체 상태 변경", category: "operations" },
  "external_access.update": { label: "외부 이용 승인 정보 수정", category: "operations" },
  "external_access.reactivate": { label: "외부 이용 재승인", category: "operations" },
  "settings.update": { label: "운영 설정 변경", category: "operations" },
} as const satisfies Record<string, { label: string; category: AdminTaskCategory }>;

export type AdminActivityAction = keyof typeof ADMIN_ACTIVITY_ACTIONS;

// Categories with a task that only AdminActivityLog records: before its
// first record these are 미측정 in part.
export const LOGGED_CATEGORIES = [...new Set(Object.values(ADMIN_ACTIVITY_ACTIONS).map((a) => a.category))] as AdminTaskCategory[];

export const ADMIN_ACTIVITY_FAILED_METRIC = "admin.activity.record_failed";
export const ADMIN_VISIT_FAILED_METRIC = "admin.visit.record_failed";

// 관리자 활동 > 로그인: a completed Google sign-in of an admin, stored in the
// same log but never counted as a task (metrics/adminActivity.ts reads it
// apart from the tasks).
export const ADMIN_SIGN_IN_ACTION = "auth.sign_in";

// A visit ends after this long without recorded activity; the next activity
// starts a new one.
export const ADMIN_VISIT_GAP_MINUTES = 30;

const kstToday = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

// A write that failed for good: one error line (ids only) and a per-day
// count the 관리자 활동 tab shows, so a gap never reads as "nothing happened".
async function countFailure(metric: string, what: string, detail: object, error: unknown) {
  console.error(`[admin-activity] ${what} failed`, JSON.stringify({ ...detail, error: error instanceof Error ? error.name : "unknown" }));
  try {
    await prisma.$executeRaw`
      INSERT INTO "MetricDaily" ("day", "metric", "value") VALUES (${kstToday()}::date, ${metric}, 1)
      ON CONFLICT ("day", "metric") DO UPDATE SET "value" = "MetricDaily"."value" + 1`;
  } catch (countError) {
    console.error("[admin-activity] failure count not recorded", countError instanceof Error ? countError.name : "unknown");
  }
}

// The task already succeeded, so a failed write never turns into an error
// for the admin -- but it is never silent either: one retry, then
// countFailure(), so a gap reads as 기록 실패, not as "no task".
export async function recordAdminActivity(
  adminUserId: number,
  action: AdminActivityAction | typeof ADMIN_SIGN_IN_ACTION,
  target?: { type: string; id: number },
): Promise<boolean> {
  const data = { adminUserId, action, targetType: target?.type ?? null, targetId: target?.id ?? null };
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await prisma.adminActivityLog.create({ data });
      return true;
    } catch (error) {
      lastError = error;
    }
  }
  await countFailure(action === ADMIN_SIGN_IN_ACTION ? ADMIN_VISIT_FAILED_METRIC : ADMIN_ACTIVITY_FAILED_METRIC, "record", data, lastError);
  return false;
}

// 관리자 활동 > 방문: called after the activity beacon's write for an admin
// (metrics/record.ts). Extends the admin's latest visit when its last
// activity is under ADMIN_VISIT_GAP_MINUTES old, else opens a new one --
// one statement, so the decision and the write cannot drift apart. A visit
// already going on when recording began is counted from its first recorded
// activity.
export async function recordAdminVisit(adminUserId: number, now: Date = new Date()): Promise<void> {
  const at = Prisma.sql`(${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  try {
    await prisma.$executeRaw`
      WITH latest AS (
        SELECT "id" FROM "AdminVisit"
        WHERE "admin_user_id" = ${adminUserId} AND "last_active_at" > ${at} - make_interval(mins => ${ADMIN_VISIT_GAP_MINUTES})
        ORDER BY "started_at" DESC LIMIT 1
      ), extended AS (
        UPDATE "AdminVisit" v SET "last_active_at" = GREATEST(v."last_active_at", ${at}) FROM latest WHERE v."id" = latest."id" RETURNING v."id"
      )
      INSERT INTO "AdminVisit" ("admin_user_id", "started_at", "last_active_at")
      SELECT ${adminUserId}, ${at}, ${at} WHERE NOT EXISTS (SELECT 1 FROM extended)`;
  } catch (error) {
    await countFailure(ADMIN_VISIT_FAILED_METRIC, "visit", { adminUserId }, error);
  }
}

// Who may see every admin's records (the 관리자 활동 tab's 전체 보기): the
// user ids in ADMIN_ACTIVITY_VIEWER_IDS (comma-separated), who must also
// be admins. Any other admin sees only their own row and history. Unset:
// nobody sees the others.
export function canViewAllAdminActivity(user: { id: number; isAdmin: boolean }, env = process.env.ADMIN_ACTIVITY_VIEWER_IDS): boolean {
  if (!user.isAdmin || !env) return false;
  return env
    .split(",")
    .map((v) => v.trim())
    .some((v) => /^\d+$/.test(v) && Number(v) === user.id);
}
