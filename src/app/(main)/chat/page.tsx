import { requireReadyUser } from "@/lib/auth/session";
import { listChatRoomsForUser } from "@/lib/chat/service";
import { ChatRoomList } from "@/components/chat/ChatRoomList";
import { ChatShell } from "@/components/chat/ChatShell";
import { getTranslator } from "@/lib/i18n/server";

// 채팅 (Phase 3-B): the room list. A phone shows the list alone (a room opens
// as its own page); from lg the list sits on the left and the right side asks
// to pick a room. Order is unchanged: newest message first.
export default async function ChatListPage() {
  const user = await requireReadyUser("chat", "/chat"); // redirects to /login or /onboarding as needed
  const t = await getTranslator();

  let rooms;
  try {
    rooms = await listChatRoomsForUser(user.id);
  } catch (error) {
    console.error("Failed to load chat rooms", error);
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-bold text-foreground">{t("chat.title")}</h1>
        <div className="rounded-card border border-destructive/30 bg-destructive-muted p-10 text-center text-sm text-destructive">{t("chat.loadError")}</div>
      </div>
    );
  }

  return (
    <ChatShell
      title={t("chat.title")}
      list={<ChatRoomList rooms={rooms} viewerId={user.id} />}
      listOnPhone
      main={<p className="m-auto px-6 text-center text-sm text-muted-foreground">{t("chat.list.selectRoom")}</p>}
    />
  );
}
