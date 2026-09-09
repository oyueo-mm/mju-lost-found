import { requireActiveUser } from "@/lib/auth/session";
import { getMyFeedback } from "@/lib/feedback/service";
import { FEEDBACK_CATEGORY_LABELS, FEEDBACK_STATUS_LABELS, type FeedbackStatusValue } from "@/lib/feedback/schema";
import { FeedbackForm } from "@/components/feedback/FeedbackForm";
import { EmptyState } from "@/components/ui/EmptyState";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

// Phase 11-5: same tone convention as admin/reports/[id]/page.tsx's own
// STATUS_TONE_CLASSES -- "아직 처리 전" reads neutral/warning, "반영됨"
// reads success, "반영하지 않음" reads muted (a real outcome, not a
// failure of this feature).
const STATUS_TONE_CLASSES: Record<FeedbackStatusValue, string> = {
  received: "bg-muted text-muted-foreground",
  in_review: "bg-warning-muted text-warning",
  planned: "bg-primary-muted text-primary",
  completed: "bg-success-muted text-success",
  not_planned: "bg-muted text-muted-foreground",
};

// Phase 11-5: "서비스 개선 제안" -- 제출 폼 + 내가 보낸 의견 목록, 한 페이지.
// requireActiveUser()가 로그인/닉네임 설정/정지 여부를 모두 확인하므로
// (Google 로그인 사용자만 제출 가능하다는 스펙을 이 한 줄로 충족), 비로그인
// 방문자는 이 페이지 자체가 렌더링되기 전에 /login으로 리다이렉트된다.
// getMyFeedback()은 항상 user.id로만 조회하므로 다른 사용자의 의견은 이
// 페이지의 어떤 경로로도 노출되지 않는다.
export default async function FeedbackPage() {
  const user = await requireActiveUser();
  const items = await getMyFeedback(user);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-foreground">서비스 개선 제안</h1>

      <FeedbackForm />

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">내가 보낸 의견</h2>

        {items.length === 0 ? (
          <EmptyState title="아직 보낸 의견이 없어요." description="위에서 첫 의견을 남겨보세요." />
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((f) => (
              <div key={f.id} className="flex flex-col gap-1.5 rounded-card border border-border bg-card p-4 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground">
                    {FEEDBACK_CATEGORY_LABELS[f.category]}
                  </span>
                  <span
                    className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE_CLASSES[f.status]}`}
                  >
                    {FEEDBACK_STATUS_LABELS[f.status]}
                  </span>
                </div>
                <p className="font-medium text-foreground">{f.title}</p>
                <p className="whitespace-pre-wrap text-muted-foreground">{f.content}</p>
                <p className="text-xs text-muted-foreground/70">{formatDate(f.createdAt)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
