"use client";

import { useState, useTransition } from "react";

import { sendThankNoteAction } from "@/app/(main)/me/thanks/actions";
import { Button } from "@/components/ui/Button";
import { THANK_NOTE_MAX_LENGTH } from "@/lib/thanks/eligibility";

// 감사 쪽지 쓰기 (post page, after the post is marked done). Optional: the
// post is already complete whether or not a note is written. Collapsed to
// one line until opened.
export function ThankNoteComposer({
  postType,
  postId,
  receivers,
  alreadySent,
}: {
  postType: "lost" | "found";
  postId: number;
  receivers: { id: number; nickname: string | null }[];
  alreadySent: boolean;
}) {
  const [receiverId, setReceiverId] = useState(receivers[0]?.id ?? 0);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(alreadySent);
  const [pending, startTransition] = useTransition();

  if (sent) {
    return (
      <p role="status" className="rounded-card border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        감사 쪽지를 보냈어요. 받은 분만 볼 수 있고, 받은 분이 원할 때만 공개돼요.
      </p>
    );
  }

  return (
    <details className="group rounded-card border border-border bg-card text-sm">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-card px-4 py-3 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        도와주신 분께 감사 쪽지 보내기 <span className="text-xs font-normal text-muted-foreground">(선택)</span>
      </summary>
      <form
        className="flex flex-col gap-3 border-t border-border px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const r = await sendThankNoteAction({ postType, postId, receiverId, body });
            if (r.ok) setSent(true);
            else setError(r.error);
          });
        }}
      >
        {receivers.length > 1 ? (
          <label className="flex flex-col gap-1.5">
            받는 분
            <select className="rounded-lg border border-border bg-transparent px-3 py-2.5" value={receiverId} onChange={(e) => setReceiverId(Number(e.target.value))}>
              {receivers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nickname ?? "이름 없음"}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-muted-foreground">받는 분: {receivers[0]?.nickname ?? "이름 없음"} (이 글로 채팅한 분)</p>
        )}
        <label className="flex flex-col gap-1.5">
          <span>감사 인사</span>
          <textarea
            required
            rows={4}
            maxLength={THANK_NOTE_MAX_LENGTH}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            aria-describedby="thank-note-hint"
            className="rounded-lg border border-border bg-transparent px-3 py-2.5"
            placeholder="예: 잃어버린 지갑을 찾아 주셔서 정말 감사합니다!"
          />
        </label>
        <p id="thank-note-hint" className="text-xs text-muted-foreground">
          이름·연락처·학번 같은 개인정보는 적지 마세요. 쪽지는 받은 분만 볼 수 있고, 받은 분이 원하면 보낸 사람 없이 프로필에 공개돼요. 한 게시글에 한 번만 보낼 수 있어요.
        </p>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" size="sm" disabled={pending || !body.trim()} className="self-start">
          {pending ? "보내는 중..." : "감사 쪽지 보내기"}
        </Button>
      </form>
    </details>
  );
}
