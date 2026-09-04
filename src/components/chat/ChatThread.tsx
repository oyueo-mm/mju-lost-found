"use client";

import { useEffect, useState } from "react";

type MessageItem = {
  id: number;
  senderUserId: number;
  senderNickname: string | null;
  content: string;
  createdAt: string;
  readAt: string | null;
  isMine: boolean;
};

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

// All message fetching/sending happens via our own server API (never a
// direct DB/AI call from this Client Component) -- see Phase 10 spec
// section 16. `isMine` comes pre-computed from the server (relative to
// the authenticated session), never derived from anything client-side.
export function ChatThread({ chatRoomId }: { chatRoomId: number }) {
  const [messages, setMessages] = useState<MessageItem[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      setError(null);
      try {
        const res = await fetch(`/api/chat/${chatRoomId}/messages`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error ?? "메시지를 불러오지 못했습니다.");
          return;
        }
        setMessages(json.data);
        setHasMore(json.pagination.hasMore);
      } catch {
        if (!cancelled) setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
      }
    }

    loadInitial();
    return () => {
      cancelled = true;
    };
  }, [chatRoomId]);

  async function loadOlder() {
    if (!messages || messages.length === 0 || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const oldestId = messages[0].id;
      const res = await fetch(`/api/chat/${chatRoomId}/messages?before=${oldestId}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "이전 메시지를 불러오지 못했습니다.");
        return;
      }
      setMessages((prev) => [...json.data, ...(prev ?? [])]);
      setHasMore(json.pagination.hasMore);
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/chat/${chatRoomId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "메시지를 보내지 못했습니다.");
        return;
      }
      setMessages((prev) => [...(prev ?? []), json.data]);
      setContent("");
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {error && (
        <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="flex flex-1 flex-col gap-3">
        {hasMore && (
          <button
            type="button"
            onClick={loadOlder}
            disabled={loadingMore}
            className="self-center rounded-full border border-zinc-300 px-4 py-1 text-xs disabled:opacity-60 dark:border-zinc-700"
          >
            {loadingMore ? "불러오는 중..." : "이전 메시지 불러오기"}
          </button>
        )}

        {messages === null ? (
          <p className="text-center text-sm text-zinc-400 dark:text-zinc-500">메시지를 불러오는 중...</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-sm text-zinc-400 dark:text-zinc-500">
            아직 주고받은 메시지가 없습니다. 첫 메시지를 보내보세요.
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex flex-col ${m.isMine ? "items-end" : "items-start"}`}>
              {!m.isMine && (
                <span className="mb-0.5 text-xs text-zinc-400 dark:text-zinc-500">{m.senderNickname ?? "알 수 없음"}</span>
              )}
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                  m.isMine
                    ? "rounded-br-sm bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                    : "rounded-bl-sm bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                }`}
              >
                {m.content}
              </div>
              <span className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
                {formatTime(m.createdAt)}
                {m.isMine ? ` · ${m.readAt ? "읽음" : "안 읽음"}` : ""}
              </span>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSend} className="flex gap-2">
        <input
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="메시지를 입력하세요"
          maxLength={2000}
          disabled={sending}
          className="flex-1 rounded-full border border-zinc-300 px-4 py-2 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-transparent"
        />
        <button
          type="submit"
          disabled={sending || !content.trim()}
          className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {sending ? "전송 중..." : "전송"}
        </button>
      </form>
    </div>
  );
}
