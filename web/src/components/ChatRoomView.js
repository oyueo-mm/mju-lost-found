"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  markRoomRead,
  toggleReaction,
  reportMessage,
  loadOlderMessages,
} from "@/lib/chat-actions";
import { formatDateTime } from "@/lib/format";
import ChatComposer from "./ChatComposer";
import ImageViewer from "./ImageViewer";

const EMOJIS = ["👍", "❤️", "😂", "😮", "😢"];

export default function ChatRoomView({
  roomId,
  meId,
  initialMessages,
  initialHasMore = false,
}) {
  const [messages, setMessages] = useState(initialMessages || []);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const bottomRef = useRef(null);
  const listRef = useRef(null);
  const supabaseRef = useRef(null);

  // 이전 메시지 페이징 — 앞에 붙인 뒤 스크롤 위치를 유지하려고 이전 높이를 기억
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const keepScrollRef = useRef(null); // { height, top }

  async function loadOlder() {
    if (loadingOlder || !hasMore) return;
    const oldest = messagesRef.current.find((m) => !m.optimistic);
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const el = listRef.current;
      if (el) keepScrollRef.current = { height: el.scrollHeight, top: el.scrollTop };
      const res = await loadOlderMessages(roomId, oldest.created_at);
      const older = (res?.messages || []).map((m) => ({ ...m, reactions: m.reactions || [] }));
      setHasMore(Boolean(res?.hasMore));
      if (older.length > 0) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          return [...older.filter((m) => !seen.has(m.id)), ...prev];
        });
      } else {
        keepScrollRef.current = null;
      }
    } catch {
      keepScrollRef.current = null;
    } finally {
      setLoadingOlder(false);
    }
  }

  const sortMsgs = (list) =>
    [...list].sort(
      (a, b) =>
        new Date(a.created_at) - new Date(b.created_at) ||
        (String(a.id) > String(b.id) ? 1 : -1),
    );

  // 서버 메시지 반영 + 같은 내용의 낙관적(임시) 메시지 제거
  const upsertMessage = useCallback((msg) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      const cleaned = prev.filter(
        (m) =>
          !(
            m.optimistic &&
            m.sender_id === msg.sender_id &&
            ((msg.content && m.content === msg.content) ||
              (msg.image_url && m.optimisticImage))
          ),
      );
      return sortMsgs([...cleaned, { ...msg, reactions: msg.reactions || [] }]);
    });
  }, []);

  // 보내는 즉시 표시할 임시 메시지 추가 → tempId 반환
  const addOptimistic = useCallback(
    (content, imageUrl) => {
      const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setMessages((prev) =>
        sortMsgs([
          ...prev,
          {
            id: tempId,
            sender_id: meId,
            content,
            image_url: imageUrl || null,
            optimisticImage: !!imageUrl,
            created_at: new Date().toISOString(),
            reactions: [],
            optimistic: true,
          },
        ]),
      );
      return tempId;
    },
    [meId],
  );

  // 전송 결과 반영: 성공이면 실제 메시지로 교체, 실패면 임시 제거
  const settleOptimistic = useCallback((tempId, realMessage) => {
    setMessages((prev) => {
      const without = prev.filter((m) => m.id !== tempId);
      if (!realMessage || without.some((m) => m.id === realMessage.id)) {
        return sortMsgs(without);
      }
      return sortMsgs([...without, { ...realMessage, reactions: [] }]);
    });
  }, []);

  const refresh = useCallback(async () => {
    const supabase = supabaseRef.current;
    if (!supabase) return;
    const cur = messagesRef.current;

    const lastId = cur
      .filter((m) => typeof m.id === "number")
      .reduce((mx, m) => Math.max(mx, m.id), 0);
    const { data: newMsgs } = await supabase
      .from("messages")
      .select("id, sender_id, content, image_url, created_at, read_at")
      .eq("room_id", roomId)
      .gt("id", lastId)
      .order("id", { ascending: true });
    (newMsgs || []).forEach(upsertMessage);

    // 내가 보낸 메시지의 '읽음' 여부 갱신 (상대가 읽으면 read_at 이 채워짐)
    const pendingMine = messagesRef.current
      .filter(
        (m) => typeof m.id === "number" && m.sender_id === meId && !m.read_at,
      )
      .map((m) => m.id);
    if (pendingMine.length > 0) {
      const { data: readRows } = await supabase
        .from("messages")
        .select("id, read_at")
        .in("id", pendingMine)
        .not("read_at", "is", null);
      if (readRows && readRows.length > 0) {
        const readMap = new Map(readRows.map((r) => [r.id, r.read_at]));
        setMessages((list) =>
          list.map((m) =>
            readMap.has(m.id) ? { ...m, read_at: readMap.get(m.id) } : m,
          ),
        );
      }
    }

    // 20초 이상 남아있는 임시 메시지는 정리 (전송 실패 잔여물)
    setMessages((list) => {
      const now = Date.now();
      const filtered = list.filter(
        (m) => !m.optimistic || now - new Date(m.created_at) < 20000,
      );
      return filtered.length === list.length ? list : filtered;
    });

    const ids = messagesRef.current
      .map((m) => m.id)
      .filter((id) => typeof id === "number");
    if (ids.length === 0) return;
    const { data: reacts } = await supabase
      .from("message_reactions")
      .select("message_id, user_id, emoji")
      .in("message_id", ids);
    if (!reacts) return;
    const byMsg = new Map();
    for (const r of reacts) {
      if (!byMsg.has(r.message_id)) byMsg.set(r.message_id, []);
      byMsg.get(r.message_id).push(r);
    }
    setMessages((list) =>
      list.map((m) =>
        typeof m.id === "number"
          ? { ...m, reactions: byMsg.get(m.id) || [] }
          : m,
      ),
    );
  }, [roomId, upsertMessage, meId]);

  useEffect(() => {
    const supabase = createClient();
    supabaseRef.current = supabase;
    let channel;
    let poll;

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) {
        await supabase.realtime.setAuth(session.access_token);
      }
      markRoomRead(roomId);

      channel = supabase
        .channel(`room-${roomId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `room_id=eq.${roomId}`,
          },
          (p) => upsertMessage(p.new),
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "messages",
            filter: `room_id=eq.${roomId}`,
          },
          (p) =>
            setMessages((list) =>
              list.map((m) =>
                m.id === p.new.id ? { ...m, read_at: p.new.read_at } : m,
              ),
            ),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "message_reactions" },
          () => refresh(),
        )
        .subscribe();

      poll = setInterval(() => {
        if (document.visibilityState === "visible") refresh();
      }, 1800);
    })();

    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      if (channel) supabase.removeChannel(channel);
      if (poll) clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  useEffect(() => {
    // 앞에 붙인 직후엔 맨 아래로 튀지 않고 보던 자리를 유지
    const keep = keepScrollRef.current;
    const el = listRef.current;
    if (keep && el) {
      keepScrollRef.current = null;
      el.scrollTop = el.scrollHeight - keep.height + keep.top;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function react(msgId, emoji) {
    // 낙관적 업데이트
    setMessages((cur) =>
      cur.map((m) => {
        if (m.id !== msgId) return m;
        const mine = (m.reactions || []).find(
          (r) => r.user_id === meId && r.emoji === emoji,
        );
        const reactions = mine
          ? m.reactions.filter(
              (r) => !(r.user_id === meId && r.emoji === emoji),
            )
          : [...(m.reactions || []), { user_id: meId, emoji }];
        return { ...m, reactions };
      }),
    );
    toggleReaction(msgId, emoji);
  }

  const lastMineId = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender_id === meId) return messages[i].id;
    }
    return null;
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-sunken">
      <div
        ref={listRef}
        className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain px-3 py-3"
      >
        {hasMore && (
          <div className="flex justify-center pb-1">
            <button
              type="button"
              onClick={loadOlder}
              disabled={loadingOlder}
              className="btn btn-ghost px-3 py-1 text-xs disabled:opacity-60"
            >
              {loadingOlder ? "불러오는 중…" : "이전 메시지 보기"}
            </button>
          </div>
        )}
        {messages.length === 0 && (
          <p className="card-dashed mx-auto mt-6 max-w-xs p-6 text-center text-sm text-ink-faint">
            첫 메시지를 보내보세요
          </p>
        )}
        {messages.map((m, i) => (
          <MessageItem
            key={m.id}
            message={m}
            mine={m.sender_id === meId}
            meId={meId}
            grouped={
              i > 0 && messages[i - 1].sender_id === m.sender_id
            }
            showReceipt={m.id === lastMineId && !m.optimistic}
            onReact={react}
            onReport={reportMessage}
          />
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="border-t border-line-soft bg-surface px-3 py-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)]">
        <ChatComposer
          roomId={roomId}
          onOptimistic={addOptimistic}
          onSent={(tempId, realMessage) => {
            settleOptimistic(tempId, realMessage);
            refresh();
          }}
        />
      </div>
    </div>
  );
}

function MessageItem({
  message,
  mine,
  meId,
  grouped,
  showReceipt,
  onReact,
  onReport,
}) {
  const [open, setOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const [viewer, setViewer] = useState(false);
  const longRef = useRef(null);
  const firedRef = useRef(false);

  const groupedReactions = groupReactions(message.reactions || []);
  const isImg = !!message.image_url;
  const canOpenImg = isImg && !message.optimisticImage;

  function pressStart() {
    firedRef.current = false;
    longRef.current = setTimeout(() => {
      firedRef.current = true;
      setOpen(true);
    }, 450);
  }
  function pressEnd() {
    clearTimeout(longRef.current);
  }
  function onBubbleClick() {
    if (firedRef.current) return; // 롱프레스로 열렸음
    if (isImg) {
      if (canOpenImg) setViewer(true);
    } else {
      setOpen((v) => !v);
    }
  }

  return (
    <div
      className={`flex flex-col ${mine ? "items-end" : "items-start"} ${
        grouped ? "mt-0.5" : "mt-2.5"
      }`}
    >
      {viewer && (
        <ImageViewer
          images={[message.image_url]}
          onClose={() => setViewer(false)}
        />
      )}
      <div className="relative">
        <div
          onClick={onBubbleClick}
          onPointerDown={pressStart}
          onPointerUp={pressEnd}
          onPointerCancel={pressEnd}
          onPointerLeave={pressEnd}
          className={`max-w-[76vw] cursor-pointer select-none overflow-hidden text-left text-sm leading-relaxed [caret-color:transparent] sm:max-w-[22rem] ${
            message.image_url ? "p-1" : "px-3.5 py-2"
          } ${
            mine
              ? "rounded-2xl rounded-br-sm bg-brand text-white"
              : "rounded-2xl rounded-bl-sm border border-line bg-surface text-ink"
          } ${message.optimistic ? "opacity-70" : ""}`}
          title={formatDateTime(message.created_at)}
        >
          {message.image_url && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={message.image_url}
              alt=""
              draggable={false}
              onLoad={(e) => e.currentTarget.scrollIntoView({ block: "end" })}
              className="block max-h-72 w-auto max-w-full rounded-xl bg-sunken object-cover"
            />
          )}
          {message.content && (
            <p
              className={`whitespace-pre-wrap break-words ${
                message.image_url ? "px-2 pb-1 pt-1.5" : ""
              }`}
            >
              {message.content}
            </p>
          )}
        </div>

        {open && (
          <div
            className={`absolute z-10 mt-1 flex items-center gap-0.5 rounded-full border border-line bg-surface p-1 shadow-pop ${
              mine ? "right-0" : "left-0"
            }`}
          >
            {["👍", "❤️", "😂", "😮", "😢"].map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => {
                  onReact(message.id, e);
                  setOpen(false);
                }}
                className="grid h-8 w-8 place-items-center rounded-full text-base transition hover:bg-sunken"
              >
                {e}
              </button>
            ))}
            {!mine && (
              <button
                type="button"
                onClick={async () => {
                  setOpen(false);
                  if (confirm("이 메시지를 신고할까요?")) {
                    const r = await onReport(message.id, "부적절한 메시지");
                    if (r?.ok || r?.error) setReported(true);
                  }
                }}
                className="ml-0.5 grid h-8 w-8 place-items-center rounded-full text-ink-faint transition hover:bg-sunken"
                aria-label="신고"
              >
                🚩
              </button>
            )}
          </div>
        )}
      </div>

      {groupedReactions.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {groupedReactions.map(({ emoji, users }) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onReact(message.id, emoji)}
              className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs ${
                users.includes(meId)
                  ? "border-brand bg-brand-tint text-brand-deep"
                  : "border-line bg-surface text-ink-soft"
              }`}
            >
              <span>{emoji}</span>
              <span className="font-semibold">{users.length}</span>
            </button>
          ))}
        </div>
      )}

      {reported && (
        <p className="mt-0.5 text-[11px] text-ink-faint">신고가 접수됐어요.</p>
      )}

      {mine && showReceipt && !message.optimistic && (
        <p className="mt-0.5 text-[11px] text-ink-faint">
          {message.read_at ? "읽음" : "전송됨"}
        </p>
      )}
    </div>
  );
}

function groupReactions(reactions) {
  const map = new Map();
  for (const r of reactions) {
    if (!map.has(r.emoji)) map.set(r.emoji, []);
    map.get(r.emoji).push(r.user_id);
  }
  return [...map.entries()].map(([emoji, users]) => ({ emoji, users }));
}
