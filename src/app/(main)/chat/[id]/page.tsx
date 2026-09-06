import Link from "next/link";
import { notFound } from "next/navigation";

import { requireReadyUser } from "@/lib/auth/session";
import { getChatRoomForUser } from "@/lib/chat/service";
import { ChatThread } from "@/components/chat/ChatThread";
import { ReportButton } from "@/components/report/ReportButton";

export default async function ChatRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = await params;
  const user = await requireReadyUser("chat", `/chat/${idParam}`); // redirects to /login or /onboarding as needed

  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  // Access is re-verified against the DB here regardless of how this
  // page was reached -- a stranger who guesses/shares this URL can't see
  // into a room they aren't a participant of (see getChatRoomForUser).
  const result = await getChatRoomForUser(id, user.id);
  if (result.kind === "not_found") notFound();
  if (result.kind !== "ok") {
    return (
      <div className="rounded-card border border-destructive/30 bg-destructive-muted p-6 text-sm text-destructive">
        이 채팅방에 접근할 권한이 없어요.
      </div>
    );
  }

  const room = result.data;

  return (
    // h-[70dvh], not h-[70vh]: `dvh` (dynamic viewport height) tracks the
    // browser's *actual* visible viewport, which shrinks when a mobile
    // on-screen keyboard opens or the browser chrome (address bar) hides/
    // shows -- plain `vh` stays pinned to the layout viewport and doesn't
    // adjust, which is what let the compose bar end up hidden behind the
    // keyboard on mobile. This bounded height is what gives ChatThread's
    // own flex column (see its own comment) a real height to fill and
    // scroll within -- no `position: fixed` needed.
    <div className="flex h-[70dvh] flex-col gap-4">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div className="flex flex-col">
          <span className="font-semibold text-foreground">
            {room.counterpart.nickname ?? "알 수 없음"}
          </span>
          <span className="text-xs text-muted-foreground">
            {room.roomType === "match"
              ? `${room.lostPost.title} ↔ ${room.foundPost.title}`
              : room.post.title}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <ReportButton
            targetType="user"
            targetId={room.counterpart.id}
            buttonLabel={`${room.counterpart.nickname ?? "상대방"}님 신고하기`}
          />
          <Link href="/chat" className="text-sm text-muted-foreground underline hover:text-foreground">
            채팅 목록
          </Link>
        </div>
      </div>

      <ChatThread chatRoomId={room.id} />
    </div>
  );
}
