import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth/session";
import { getFeedbackForAdmin } from "@/lib/feedback/service";
import { FEEDBACK_CATEGORY_LABELS } from "@/lib/feedback/schema";
import { FeedbackStatusForm } from "@/components/admin/FeedbackStatusForm";
import { ChatBubbleIcon } from "@/components/icons";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(date);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-card border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

// Same detail-page shape as admin/reports/[id]/page.tsx (내용 / 작성자 /
// 상태 변경 sections) -- getFeedbackForAdmin() re-checks isAdmin() itself
// regardless of this page's own requireAdmin() gate.
export default async function AdminFeedbackDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  const result = await getFeedbackForAdmin(admin, id);
  if (result.kind === "not_found") notFound();
  if (result.kind !== "ok") {
    return (
      <div className="rounded-card border border-destructive/30 bg-destructive-muted p-4 text-sm text-destructive">
        의견을 불러오는 중 문제가 발생했습니다.
      </div>
    );
  }

  const feedback = result.data;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-muted text-primary">
            <ChatBubbleIcon className="size-4.5" />
          </span>
          <h1 className="text-lg font-semibold text-foreground">
            의견 #{feedback.id} · {FEEDBACK_CATEGORY_LABELS[feedback.category]}
          </h1>
        </div>
        <Link href="/admin/feedback" className="text-sm font-medium text-muted-foreground hover:text-foreground">
          목록으로
        </Link>
      </div>

      <Section title="내용">
        <p className="font-medium text-foreground">{feedback.title}</p>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{feedback.content}</p>
      </Section>

      <Section title="작성자 정보">
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          <span>작성자: {feedback.author.nickname ?? "알 수 없음"}</span>
          <span>작성일: {formatDate(feedback.createdAt)}</span>
        </div>
      </Section>

      <Section title="처리">
        <FeedbackStatusForm
          feedbackId={feedback.id}
          currentStatus={feedback.status}
          currentAdminNote={feedback.adminNote}
        />
      </Section>
    </div>
  );
}
