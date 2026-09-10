import Link from "next/link";

import { requireReadyUser } from "@/lib/auth/session";
import { listChatRoomsForUser, type ChatRoomListItemDTO } from "@/lib/chat/service";
import { EmptyState } from "@/components/ui/EmptyState";
import { ChatIcon, ShieldIcon } from "@/components/icons";

// Phase 12-11 §13/§14: a personal room shows the counterpart's nickname,
// unchanged. An organization room is context-aware -- the inquirer's own
// list just shows the organization's name (same as any other "who am I
// talking to" label); a manager's list, viewing someone else's inquiry,
// shows "문의자 → 단체명" instead so they can tell inquiries apart without
// opening each one. Never renders any manager's own identity here (there
// can be several, and the room isn't "about" any one of them).
function roomTitle(room: ChatRoomListItemDTO, viewerId: number): string {
  if (room.counterpart.kind === "organization") {
    if (room.inquirer && room.inquirer.id !== viewerId) {
      return `${room.inquirer.nickname ?? "알 수 없음"} → ${room.counterpart.name}`;
    }
    return room.counterpart.name;
  }
  return room.counterpart.nickname ?? "알 수 없음";
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(date);
}

export default async function ChatListPage() {
  const user = await requireReadyUser("chat", "/chat"); // redirects to /login or /onboarding as needed

  let rooms;
  try {
    rooms = await listChatRoomsForUser(user.id);
  } catch (error) {
    console.error("Failed to load chat rooms", error);
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold text-foreground">채팅</h1>
        <div className="rounded-card border border-destructive/30 bg-destructive-muted p-10 text-center text-sm text-destructive">
          채팅 목록을 불러오지 못했어요. 잠시 후 다시 시도해주세요.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-foreground">채팅</h1>

      {rooms.length === 0 ? (
        <EmptyState
          title="아직 채팅방이 없어요."
          description="게시글 상세 화면에서 매칭을 확정하거나 작성자에게 문의하기를 누르면 채팅을 시작할 수 있어요."
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {rooms.map((room) => (
            <Link
              key={room.id}
              href={`/chat/${room.id}`}
              className="flex items-center gap-3 rounded-card border border-border bg-card p-4 text-sm transition-colors hover:border-foreground/30"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-muted text-primary">
                {room.counterpart.kind === "organization" ? (
                  <ShieldIcon className="size-5" />
                ) : (
                  <ChatIcon className="size-5" />
                )}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold text-foreground">{roomTitle(room, user.id)}</span>
                  {room.lastMessage && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDate(room.lastMessage.createdAt)}
                    </span>
                  )}
                </div>
                <span className="truncate text-xs text-muted-foreground">{room.post.title}</span>
                <p className="truncate text-muted-foreground">
                  {room.lastMessage ? room.lastMessage.content : "아직 주고받은 메시지가 없어요."}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
