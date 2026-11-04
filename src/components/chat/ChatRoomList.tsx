import Link from "next/link";

import { FallbackImage } from "@/components/ui/FallbackImage";
import { ChatIcon, ShieldIcon } from "@/components/icons";
import type { ChatRoomListItemDTO } from "@/lib/chat/service";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { LOCALE_INTL_TAG, type Locale } from "@/lib/i18n/config";

// Phase 3-B: the chat list as plain rows (당근-style) -- the post's small
// photo, the other person, when, the post's title (and 완료 once done), the
// latest message, and the unread count. Used by /chat (the whole list on a
// phone) and, from lg, beside the open room. Order is the server's (newest
// message first), unchanged.

function counterpartName(room: ChatRoomListItemDTO, viewerId: number, unknown: string): string {
  if (room.counterpart.kind === "organization") {
    if (room.inquirer && room.inquirer.id !== viewerId) return `${room.inquirer.nickname ?? unknown} → ${room.counterpart.name}`;
    return room.counterpart.name;
  }
  return room.counterpart.nickname ?? unknown;
}

// today: the time; otherwise the date (KST, the reader's language)
function shortTime(date: Date, locale: Locale): string {
  const tag = LOCALE_INTL_TAG[locale];
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);
  return day(date) === day(new Date())
    ? new Intl.DateTimeFormat(tag, { timeStyle: "short", timeZone: "Asia/Seoul" }).format(date)
    : new Intl.DateTimeFormat(tag, { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" }).format(date);
}

export async function ChatRoomList({ rooms, viewerId, activeId }: { rooms: ChatRoomListItemDTO[]; viewerId: number; activeId?: number }) {
  const [t, locale] = await Promise.all([getTranslator(), getLocale()]);
  if (rooms.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 px-4 py-10 text-center text-sm">
        <p className="font-medium text-foreground">{t("chat.empty.title")}</p>
        <p className="text-muted-foreground">{t("chat.empty.description")}</p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col" aria-label={t("chat.title")}>
      {rooms.map((room) => {
        const active = room.id === activeId;
        const unread = room.unreadCount;
        return (
          <li key={room.id} className="border-b border-border last:border-b-0">
            <Link
              href={`/chat/${room.id}`}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-16 items-center gap-3 px-3 py-3 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${
                active ? "bg-primary-muted/70" : "hover:bg-muted/60"
              }`}
            >
              <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted text-muted-foreground">
                {room.post.imageUrl ? (
                  <FallbackImage
                    src={room.post.imageUrl}
                    alt=""
                    fill
                    sizes="48px"
                    className="object-cover"
                    fallback={room.counterpart.kind === "organization" ? <ShieldIcon className="size-5" /> : <ChatIcon className="size-5" />}
                  />
                ) : room.counterpart.kind === "organization" ? (
                  <ShieldIcon aria-hidden="true" className="size-5" />
                ) : (
                  <ChatIcon aria-hidden="true" className="size-5" />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-foreground">{counterpartName(room, viewerId, t("common.unknown"))}</span>
                  {room.lastMessage && (
                    <time dateTime={room.lastMessage.createdAt.toISOString()} className="shrink-0 text-xs text-muted-foreground">
                      {shortTime(room.lastMessage.createdAt, locale)}
                    </time>
                  )}
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  {room.post.completed && (
                    <span className="shrink-0 rounded-full bg-success-muted px-1.5 py-px text-[11px] font-medium text-success">{t("chat.list.done")}</span>
                  )}
                  <span className="truncate">{room.post.deleted ? `${t("chat.deletedPost")} · ${room.post.title}` : room.post.title}</span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className={`truncate text-sm ${unread > 0 ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                    {room.lastMessage ? room.lastMessage.content : t("chat.noMessages")}
                  </span>
                  {unread > 0 && (
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular-nums">
                      <span aria-hidden="true">{unread > 99 ? "99+" : unread}</span>
                      <span className="sr-only">{t("chat.list.unread", { count: unread })}</span>
                    </span>
                  )}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
