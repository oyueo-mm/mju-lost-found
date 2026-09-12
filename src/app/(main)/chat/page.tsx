import Link from "next/link";

import { requireReadyUser } from "@/lib/auth/session";
import { listChatRoomsForUser, type ChatRoomListItemDTO } from "@/lib/chat/service";
import { EmptyState } from "@/components/ui/EmptyState";
import { ChatIcon, ShieldIcon } from "@/components/icons";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { LOCALE_INTL_TAG, type Locale } from "@/lib/i18n/config";

// Phase 12-11 §13/§14: a personal room shows the counterpart's nickname,
// unchanged. An organization room is context-aware -- the inquirer's own
// list just shows the organization's name (same as any other "who am I
// talking to" label); a manager's list, viewing someone else's inquiry,
// shows "문의자 → 단체명" instead so they can tell inquiries apart without
// opening each one. Never renders any manager's own identity here (there
// can be several, and the room isn't "about" any one of them).
function roomTitle(room: ChatRoomListItemDTO, viewerId: number, unknown: string): string {
  if (room.counterpart.kind === "organization") {
    if (room.inquirer && room.inquirer.id !== viewerId) {
      return `${room.inquirer.nickname ?? unknown} → ${room.counterpart.name}`;
    }
    return room.counterpart.name;
  }
  return room.counterpart.nickname ?? unknown;
}

// 다국어(i18n) Phase: 하드코딩된 "ko-KR" 대신 현재 언어의 Intl 태그.
// 타임존은 언제나 Asia/Seoul 그대로다.
function formatDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALE_INTL_TAG[locale], {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(date);
}

export default async function ChatListPage() {
  const user = await requireReadyUser("chat", "/chat"); // redirects to /login or /onboarding as needed
  const [t, locale] = await Promise.all([getTranslator(), getLocale()]);

  let rooms;
  try {
    rooms = await listChatRoomsForUser(user.id);
  } catch (error) {
    console.error("Failed to load chat rooms", error);
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold text-foreground">{t("chat.title")}</h1>
        <div className="rounded-card border border-destructive/30 bg-destructive-muted p-10 text-center text-sm text-destructive">
          {t("chat.loadError")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-foreground">{t("chat.title")}</h1>

      {rooms.length === 0 ? (
        <EmptyState
          title={t("chat.empty.title")}
          description={t("chat.empty.description")}
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
                  <span className="truncate font-semibold text-foreground">{roomTitle(room, user.id, t("common.unknown"))}</span>
                  {room.lastMessage && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDate(room.lastMessage.createdAt, locale)}
                    </span>
                  )}
                </div>
                <span className="truncate text-xs text-muted-foreground">{room.post.title}</span>
                <p className="truncate text-muted-foreground">
                  {room.lastMessage ? room.lastMessage.content : t("chat.noMessages")}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
