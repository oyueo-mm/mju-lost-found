import { prisma } from "@/lib/db/prisma";

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

// The task already succeeded, so a failed write never turns into an error
// for the admin -- but it is never silent either: one retry, then an error
// log line (ids only) and a per-day failure count the 관리자 활동 tab shows,
// so a gap reads as 기록 실패, not as "no task".
export async function recordAdminActivity(
  adminUserId: number,
  action: AdminActivityAction,
  target?: { type: string; id: number },
): Promise<boolean> {
  const data = { adminUserId, action, targetType: target?.type ?? null, targetId: target?.id ?? null };
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await prisma.adminActivityLog.create({ data });
      return true;
    } catch (error) {
      if (attempt === 2) {
        console.error("[admin-activity] record failed", JSON.stringify({ ...data, error: error instanceof Error ? error.name : "unknown" }));
      }
    }
  }
  try {
    const kst = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
    await prisma.$executeRaw`
      INSERT INTO "MetricDaily" ("day", "metric", "value") VALUES (${kst}::date, ${ADMIN_ACTIVITY_FAILED_METRIC}, 1)
      ON CONFLICT ("day", "metric") DO UPDATE SET "value" = "MetricDaily"."value" + 1`;
  } catch (error) {
    console.error("[admin-activity] failure count not recorded", error instanceof Error ? error.name : "unknown");
  }
  return false;
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
