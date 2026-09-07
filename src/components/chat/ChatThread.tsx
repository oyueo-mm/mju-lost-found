"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

import { uploadChatImage, validateImageFile } from "@/lib/images/client";
import { MessageActionMenu } from "@/components/chat/MessageActionMenu";

// Phase D-3: mirrors chat/service.ts's MessageReplyPreview -- no
// createdAt/etc, just enough to render an inline quote (sender + a short
// snippet), same "preview travels with the reply, no second round-trip"
// shape the server already sends.
type ReplyPreview = {
  id: number;
  senderNickname: string | null;
  content: string;
  hasImage: boolean;
};

// Phase D-4: mirrors chat/service.ts's ReactionSummary -- one entry per
// distinct emoji actually used, never one per individual reaction.
type ReactionSummary = { emoji: string; count: number; reactedByMe: boolean };

type MessageItem = {
  id: number;
  senderUserId: number;
  senderNickname: string | null;
  content: string;
  imageUrl: string | null;
  createdAt: string;
  readAt: string | null;
  isMine: boolean;
  replyTo: ReplyPreview | null;
  reactions: ReactionSummary[];
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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  // Phase D-3: which message (if any) the compose bar is currently
  // replying to -- built directly from that message's own already-loaded
  // MessageItem (no extra fetch needed, same reasoning as
  // MessageActionMenu's own "no server round-trip for a client action"
  // design).
  const [replyingTo, setReplyingTo] = useState<ReplyPreview | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Whether the view should follow along to the newest message -- starts
  // true (a freshly opened room should land on the latest message), kept
  // in sync by handleScroll below. A user who has scrolled up to read
  // history sets this to false, so a later re-render (e.g. loadOlder
  // prepending history, or a stray state update) never yanks their
  // position back down to the bottom.
  const stickToBottomRef = useRef(true);

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

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // Cleanup only needs to run once, on unmount -- revoking on every
    // dependency change would invalidate a preview still on screen (same
    // pattern ImageUploader.tsx's own preview cleanup uses).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll to the newest message: on initial load (stickToBottomRef
  // starts true, so the very first non-null `messages` lands here), and
  // whenever the last message id changes (a new message was sent or
  // appended -- see handleSend). Deliberately keyed on the *last message's
  // id*, not `messages` itself/its length -- loadOlder() prepends older
  // messages onto the front of the array without changing what the last
  // one is, so this effect doesn't fire for that case at all (no
  // scroll-to-bottom needed while paging up through history, matching the
  // "이전 메시지 불러오기" flow's own intent). When it does fire, whether it
  // actually scrolls still depends on stickToBottomRef -- a new message
  // arriving while the user is reading old ones doesn't yank them down.
  const lastMessageId = messages && messages.length > 0 ? messages[messages.length - 1].id : null;
  useEffect(() => {
    if (lastMessageId === null) return;
    if (stickToBottomRef.current) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [lastMessageId]);

  // Keeps stickToBottomRef in sync with where the user actually is --
  // within ~80px of the bottom counts as "following along". A small
  // threshold (not 0) so a smooth-scroll animation settling slightly
  // early/late, or the image onLoad re-scroll below, doesn't itself flip
  // this to false.
  function handleScroll() {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
  }

  // A message image loads asynchronously and can grow the scroll
  // container's height *after* the id-keyed effect above already ran --
  // without this, a photo message would often land just short of fully
  // in view. Re-checking stickToBottomRef here (not scrolling
  // unconditionally) keeps this consistent with "don't yank a user who's
  // scrolled away from the bottom".
  function handleImageLoad() {
    if (stickToBottomRef.current) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }

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

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setImageError(null);

    if (!file) {
      clearSelectedFile();
      return;
    }

    const validationError = validateImageFile(file);
    if (validationError) {
      setImageError(validationError.message);
      event.target.value = "";
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  function clearSelectedFile() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Image-only, text-only, or both -- the only thing required to enable
  // sending is that at least one of the two is present (mirrors
  // sendMessageSchema's own .refine() server-side). Upload happens first
  // (POST /api/chat/[id]/upload -> direct-to-Storage), then the resulting
  // path is reported to POST /api/chat/[id]/messages alongside the text,
  // same two-step "upload, then attach" flow post images already use.
  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = content.trim();
    if ((!trimmed && !selectedFile) || sending) return;
    setSending(true);
    setError(null);
    try {
      let imagePath: string | undefined;
      if (selectedFile) {
        try {
          const uploaded = await uploadChatImage(chatRoomId, selectedFile);
          imagePath = uploaded.path;
        } catch {
          setError("이미지 업로드에 실패했습니다.");
          return;
        }
      }

      const res = await fetch(`/api/chat/${chatRoomId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: trimmed || undefined,
          imagePath,
          replyToMessageId: replyingTo?.id,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "메시지를 보내지 못했습니다.");
        return;
      }
      setMessages((prev) => [...(prev ?? []), json.data]);
      setContent("");
      clearSelectedFile();
      setReplyingTo(null);
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setSending(false);
    }
  }

  // Phase D-4: the server always returns that one message's *full*
  // reaction summary (never a delta) -- see toggleMessageReaction()'s own
  // comment on why counts are never incremented/decremented optimistically
  // on the client (another participant may have reacted concurrently).
  function handleReactionChange(messageId: number, reactions: ReactionSummary[]) {
    setMessages((prev) => (prev ? prev.map((m) => (m.id === messageId ? { ...m, reactions } : m)) : prev));
  }

  // Single fetch reused by both MessageActionMenu's emoji picker and the
  // reaction badges' own click-to-toggle below -- same PATCH
  // /api/chat/[id]/messages route the GET/POST handlers already live on
  // (no new API route). Throws on failure so MessageActionMenu can show
  // the error inline in its picker; badge clicks fall back to the
  // existing top-level error banner instead of their own per-message UI.
  async function toggleReaction(messageId: number, emoji: string) {
    const res = await fetch(`/api/chat/${chatRoomId}/messages`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, emoji }),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error ?? "반응을 남기지 못했습니다.");
    }
    handleReactionChange(messageId, json.data.reactions);
  }

  return (
    // min-h-0 on both this root and the message list below is what makes
    // the compose bar actually stay put as messages accumulate: a flex
    // child's default min-height is `auto` (its own content size), not
    // `0` -- without overriding that, `flex-1` on the message list can
    // grow past its parent's bounded height (set by the chat page's own
    // `h-[70dvh]` wrapper) instead of shrinking to fit and scrolling
    // internally, which is what was pushing the input off-screen as the
    // thread grew. No `position: fixed` needed -- the page's own bounded-
    // height flex column already gives every descendant a real height to
    // fill, this was just missing the one declaration that lets a flex
    // item respect it.
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {error && (
        <p className="rounded-lg bg-destructive-muted px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div ref={listRef} onScroll={handleScroll} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {hasMore && (
          <button
            type="button"
            onClick={loadOlder}
            disabled={loadingMore}
            className="self-center rounded-full border border-border px-4 py-1 text-xs text-foreground disabled:opacity-60"
          >
            {loadingMore ? "불러오는 중..." : "이전 메시지 불러오기"}
          </button>
        )}

        {messages === null ? (
          <p className="text-center text-sm text-muted-foreground">메시지를 불러오는 중...</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">
            아직 주고받은 메시지가 없어요. 첫 메시지를 보내보세요.
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex flex-col ${m.isMine ? "items-end" : "items-start"}`}>
              {!m.isMine && (
                <span className="mb-0.5 text-xs text-muted-foreground">{m.senderNickname ?? "알 수 없음"}</span>
              )}
              {/* Phase D-2: replaces the always-visible "신고" link with an
                  action menu (desktop hover "⋯", mobile long-press) --
                  wraps just the image/bubble (not the sender label or
                  timestamp below), so the press target is the message
                  content itself. createReport() itself still rejects
                  reporting your own message, so this isn't hidden for
                  m.isMine either -- same "validate at submit, not in the
                  UI" rule the old always-visible button used. */}
              <MessageActionMenu
                messageId={m.id}
                align={m.isMine ? "end" : "start"}
                onReply={() =>
                  setReplyingTo({
                    id: m.id,
                    senderNickname: m.senderNickname,
                    content: m.content,
                    hasImage: Boolean(m.imageUrl),
                  })
                }
                onReact={(emoji) => toggleReaction(m.id, emoji)}
              >
                {m.replyTo && (
                  <div
                    className={`mb-1 max-w-full truncate rounded-lg border-l-2 border-border bg-muted/60 px-2 py-1 text-xs text-muted-foreground`}
                  >
                    <span className="font-medium">{m.replyTo.senderNickname ?? "알 수 없음"}</span>
                    {": "}
                    {m.replyTo.content || (m.replyTo.hasImage ? "사진" : "")}
                  </div>
                )}
                {m.imageUrl && (
                  <div className="mb-1 max-w-[240px] overflow-hidden rounded-2xl border border-border">
                    <Image
                      src={m.imageUrl}
                      alt="전송된 이미지"
                      width={480}
                      height={480}
                      className="h-auto w-full"
                      onLoad={handleImageLoad}
                    />
                  </div>
                )}
                {m.content && (
                  <div
                    className={`rounded-2xl px-4 py-2 text-sm ${
                      m.isMine
                        ? "rounded-br-sm bg-primary text-primary-foreground"
                        : "rounded-bl-sm bg-muted text-foreground"
                    }`}
                  >
                    {m.content}
                  </div>
                )}
              </MessageActionMenu>
              {/* Phase D-4: existing badges are themselves clickable (not
                  just the picker) -- tapping your own already-picked emoji
                  again removes it, same toggle semantics as picking it
                  fresh from the menu, just faster than opening the menu
                  again. reactedByMe gets a filled/tinted style so it's
                  visually distinct from a badge you haven't picked. */}
              {m.reactions.length > 0 && (
                <div className={`mt-1 flex flex-wrap gap-1 ${m.isMine ? "justify-end" : "justify-start"}`}>
                  {m.reactions.map((r) => (
                    <button
                      key={r.emoji}
                      type="button"
                      onClick={() => toggleReaction(m.id, r.emoji).catch(() => setError("반응을 남기지 못했습니다."))}
                      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                        r.reactedByMe
                          ? "border-primary bg-primary-muted text-primary"
                          : "border-border bg-card text-muted-foreground hover:border-foreground/30"
                      }`}
                    >
                      <span>{r.emoji}</span>
                      <span>{r.count}</span>
                    </button>
                  ))}
                </div>
              )}
              <span className="mt-0.5 text-xs text-muted-foreground">
                {formatTime(m.createdAt)}
                {m.isMine ? ` · ${m.readAt ? "읽음" : "안 읽음"}` : ""}
              </span>
            </div>
          ))
        )}
        {/* Bottom sentinel -- scrollIntoView({ block: "end" }) targets this
            empty marker rather than the list container itself, so the
            scroll lands exactly past the last message regardless of its
            height (including a photo's, once it finishes loading -- see
            handleImageLoad). */}
        <div ref={bottomRef} />
      </div>

      {/* shrink-0: the compose area's own natural height is never
          compressed by flex-shrink, so it stays fully visible at the
          bottom regardless of how tall the (already min-h-0-capped)
          message list above gets. */}
      <div className="flex shrink-0 flex-col gap-2">
        {imageError && <p className="text-xs text-destructive">{imageError}</p>}

        {previewUrl && (
          <div className="relative w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob: object URL preview, not a remote/optimizable image. */}
            <img src={previewUrl} alt="선택한 이미지 미리보기" className="h-20 w-20 rounded-lg object-cover" />
            <button
              type="button"
              onClick={clearSelectedFile}
              disabled={sending}
              className="absolute -top-1.5 -right-1.5 rounded-full bg-card px-1.5 py-0.5 text-xs text-destructive shadow-sm disabled:opacity-60"
            >
              ×
            </button>
          </div>
        )}

        {replyingTo && (
          <div className="flex items-center gap-2 rounded-lg border-l-2 border-primary bg-muted/60 px-3 py-1.5 text-xs">
            <div className="min-w-0 flex-1 truncate">
              <span className="font-medium text-foreground">{replyingTo.senderNickname ?? "알 수 없음"}</span>
              <span className="text-muted-foreground">
                {": "}
                {replyingTo.content || (replyingTo.hasImage ? "사진" : "")}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              aria-label="답장 취소"
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </div>
        )}

        <form onSubmit={handleSend} className="flex gap-2">
          <label className="flex shrink-0 cursor-pointer items-center justify-center rounded-full border border-border px-3 text-sm text-foreground hover:border-foreground/30 has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50">
            사진
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={sending}
              onChange={handleFileChange}
              className="sr-only"
            />
          </label>
          <input
            type="text"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="메시지를 입력하세요"
            maxLength={2000}
            disabled={sending}
            className="flex-1 rounded-full border border-border bg-transparent px-4 py-2 text-sm text-foreground disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={sending || (!content.trim() && !selectedFile)}
            className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {sending ? "전송 중..." : "전송"}
          </button>
        </form>
      </div>
    </div>
  );
}
