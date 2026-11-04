import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createTranslator } from "@/lib/i18n/translate";
import { ko } from "@/lib/i18n/messages/ko";
import type { ChatRoomListItemDTO } from "@/lib/chat/service";

vi.mock("@/lib/i18n/server", () => ({ getTranslator: vi.fn(async () => createTranslator("ko", ko)), getLocale: vi.fn(async () => "ko") }));
const { ChatRoomList } = await import("./ChatRoomList");

const room = (id: number, extra: Partial<ChatRoomListItemDTO> = {}): ChatRoomListItemDTO =>
  ({
    roomType: "direct",
    id,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    counterpart: { kind: "user", id: 2, nickname: `상대${id}`, publicId: "p", userType: "STUDENT" },
    inquirer: null,
    post: { id: 5, title: `검은 지갑 ${id}`, type: "lost", imageUrl: null, deleted: false, completed: false },
    lastMessage: { content: "내일 학생회관에서 뵐게요", createdAt: new Date("2026-11-01T03:00:00Z") },
    unreadCount: 0,
    ...extra,
  }) as ChatRoomListItemDTO;

const render = async (rooms: ChatRoomListItemDTO[], activeId?: number) => renderToStaticMarkup(await ChatRoomList({ rooms, viewerId: 1, activeId }));

describe("채팅방 목록 (Phase 3-B)", () => {
  it("shows the other person, the post title, the last message and links each row to its room, in the given order", async () => {
    const html = await render([room(3), room(1)]);
    expect(html.indexOf('href="/chat/3"')).toBeLessThan(html.indexOf('href="/chat/1"'));
    for (const s of ["상대3", "검은 지갑 3", "내일 학생회관에서 뵐게요"]) expect(html).toContain(s);
  });

  it("shows the unread count (capped at 99+) with a screen-reader label, and nothing when read", async () => {
    expect(await render([room(1, { unreadCount: 3 })])).toMatch(/>3<\/span><span class="sr-only">읽지 않은 메시지 3개</);
    expect(await render([room(1, { unreadCount: 150 })])).toContain(">99+<");
    expect(await render([room(1)])).not.toContain("읽지 않은 메시지");
  });

  it("marks a done post and the open room", async () => {
    const html = await render([room(1, { post: { id: 5, title: "x", type: "lost", imageUrl: null, deleted: false, completed: true } }), room(2)], 2);
    expect(html).toContain(`>${ko["chat.list.done"]}<`);
    expect(html).toMatch(/aria-current="page"[^>]*href="\/chat\/2"|href="\/chat\/2"[^>]*aria-current="page"/);
  });

  it("has a small empty state", async () => {
    const html = await render([]);
    expect(html).toContain(ko["chat.empty.title"]);
    expect(html).not.toContain("<ul");
  });
});
