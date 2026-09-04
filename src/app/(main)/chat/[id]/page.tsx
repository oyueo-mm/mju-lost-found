import Link from "next/link";
import { notFound } from "next/navigation";

import { requireReadyUser } from "@/lib/auth/session";
import { getChatRoomForUser } from "@/lib/chat/service";
import { ChatThread } from "@/components/chat/ChatThread";

export default async function ChatRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireReadyUser(); // redirects to /login or /onboarding as needed

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  // Access is re-verified against the DB here regardless of how this
  // page was reached -- a stranger who guesses/shares this URL can't see
  // into a room they aren't a participant of (see getChatRoomForUser).
  const result = await getChatRoomForUser(id, user.id);
  if (result.kind === "not_found") notFound();
  if (result.kind !== "ok") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        이 채팅방에 접근할 권한이 없습니다.
      </div>
    );
  }

  const room = result.data;

  return (
    <div className="flex h-[70vh] flex-col gap-4">
      <div className="flex items-center justify-between border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <div className="flex flex-col">
          <span className="font-medium text-zinc-900 dark:text-zinc-50">
            {room.counterpart.nickname ?? "알 수 없음"}
          </span>
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            {room.lostPost.title} ↔ {room.foundPost.title}
          </span>
        </div>
        <Link href="/chat" className="text-sm text-zinc-500 underline dark:text-zinc-400">
          채팅 목록
        </Link>
      </div>

      <ChatThread chatRoomId={room.id} />
    </div>
  );
}
