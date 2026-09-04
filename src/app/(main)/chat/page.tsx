import Link from "next/link";

import { requireReadyUser } from "@/lib/auth/session";
import { listChatRoomsForUser } from "@/lib/chat/service";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default async function ChatListPage() {
  const user = await requireReadyUser(); // redirects to /login or /onboarding as needed

  let rooms;
  try {
    rooms = await listChatRoomsForUser(user.id);
  } catch (error) {
    console.error("Failed to load chat rooms", error);
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">채팅</h1>
        <div className="rounded-lg border border-red-200 bg-red-50 p-10 text-center text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          채팅 목록을 불러오는 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">채팅</h1>

      {rooms.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          아직 채팅방이 없습니다. 게시물 상세 화면에서 매칭을 확정하면 채팅을 시작할 수 있습니다.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {rooms.map((room) => (
            <Link
              key={room.id}
              href={`/chat/${room.id}`}
              className="flex flex-col gap-1 rounded-lg border border-zinc-200 p-4 text-sm hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-zinc-900 dark:text-zinc-50">
                  {room.counterpart.nickname ?? "알 수 없음"}
                </span>
                {room.lastMessage && (
                  <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
                    {formatDate(room.lastMessage.createdAt)}
                  </span>
                )}
              </div>
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                {room.lostPost.title} ↔ {room.foundPost.title}
              </span>
              <p className="truncate text-zinc-600 dark:text-zinc-400">
                {room.lastMessage ? room.lastMessage.content : "아직 주고받은 메시지가 없습니다."}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
