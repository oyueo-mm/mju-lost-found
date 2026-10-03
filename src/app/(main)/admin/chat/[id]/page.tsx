import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth/session";
import { getChatRoomForAdmin } from "@/lib/chat/service";
import { ChatIcon } from "@/components/icons";

// Same UTC-vs-KST fix admin/users/[id]/page.tsx already applies (Vercel's
// Node runtime has no TZ env var set, defaults to UTC).
function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(
    date,
  );
}

// Phase 11-1: admin-only, read-only room view -- reached only from
// /admin/reports/[id]'s "채팅방으로 이동" link on a message-target report
// (this phase's own P0 finding). Not a general chat viewer: no compose
// bar, no reply/react/edit/delete -- moderation *actions* still go
// through the existing "관리자 처리" form on the report page, this page
// only exists to show surrounding context. See chat/service.ts's
// getChatRoomForAdmin for why this is a separate function from the
// participant-gated getChatRoomForUser (regular user chat permissions are
// completely unchanged by this Phase).
export default async function AdminChatRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ report?: string }>;
}) {
  const admin = await requireAdmin();

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  const { report: reportIdParam } = await searchParams;
  const reportId = reportIdParam && /^\d+$/.test(reportIdParam) ? Number(reportIdParam) : null;
  const backHref = reportId !== null ? `/admin/reports/${reportId}` : "/admin/reports";

  // Admin chat access Phase: only through a message report for this very
  // room (checked and logged in getChatRoomForAdmin) -- no report, another
  // report, or a room the report doesn't point at shows nothing.
  const result = reportId !== null ? await getChatRoomForAdmin(id, reportId, admin) : ({ kind: "forbidden" } as const);
  if (result.kind === "not_found") notFound();
  if (result.kind === "forbidden") {
    return (
      <div className="flex flex-col gap-3">
        <Link href={backHref} className="text-sm text-muted-foreground hover:underline">
          ← 신고 목록으로 돌아가기
        </Link>
        <div className="rounded-card border border-border bg-card p-6 text-sm text-muted-foreground">
          채팅방은 해당 채팅방의 메시지를 대상으로 한 신고에서만 열람할 수 있습니다.
        </div>
      </div>
    );
  }
  const room = result.data;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Link href={backHref} className="text-sm text-muted-foreground hover:underline">
          ← 신고로 돌아가기
        </Link>
        <div className="flex items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-muted text-primary">
            <ChatIcon className="size-4.5" />
          </span>
          <h1 className="text-lg font-semibold text-foreground">채팅방 #{room.id}</h1>
        </div>
      </div>

      <section className="flex flex-col gap-1 rounded-card border border-border bg-card p-4 text-sm">
        <span className="text-xs font-medium text-muted-foreground">관련 게시글</span>
        {room.post.deleted ? (
          <span className="text-foreground">삭제된 게시글 · {room.post.title}</span>
        ) : (
          <Link
            href={`/post/${room.post.id}?type=${room.post.type}`}
            className="font-medium text-primary hover:opacity-80"
          >
            {room.post.title}
          </Link>
        )}
        <span className="mt-2 text-xs font-medium text-muted-foreground">참여자</span>
        <span className="text-foreground">
          {room.participants.map((p) => p.nickname ?? "알 수 없음").join(", ")}
        </span>
      </section>

      <section className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">메시지 ({room.messages.length}건)</h2>
        {room.messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">메시지가 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {room.messages.map((m) => (
              <li key={m.id} className="flex flex-col gap-0.5 border-b border-border pb-3 text-sm last:border-b-0 last:pb-0">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{m.senderNickname ?? "알 수 없음"}</span>
                  <span>{formatDateTime(m.createdAt)}</span>
                </div>
                <p className={m.isDeleted ? "text-muted-foreground italic" : "text-foreground"}>{m.content}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
