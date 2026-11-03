"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { hideThankNoteAction, setThankNotePublishedAction } from "@/app/(main)/me/thanks/actions";
import type { ReceivedThankNote } from "@/lib/thanks/service";

// 받은 감사 쪽지: private by default. Publishing asks once more, since a
// published note can be read by anyone on the profile (without its sender).
export function ReceivedThankNotes({ notes, dateLabels }: { notes: ReceivedThankNote[]; dateLabels: Record<number, string> }) {
  const [items, setItems] = useState(notes);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) return <p className="rounded-card border border-border bg-card p-5 text-sm text-muted-foreground">아직 받은 감사 쪽지가 없어요.</p>;

  const publish = (n: ReceivedThankNote, published: boolean) => {
    if (published && !window.confirm("이 쪽지를 내 프로필에 공개할까요? 누구나 볼 수 있지만 보낸 분은 표시되지 않아요. 언제든 다시 비공개로 바꿀 수 있어요.")) return;
    startTransition(async () => {
      const r = await setThankNotePublishedAction(n.id, published);
      if (r.ok) setItems((all) => all.map((x) => (x.id === n.id ? { ...x, published } : x)));
      else setError(r.reason === "personal" ? "연락처·학번처럼 보이는 정보가 있어 공개할 수 없어요. 나만 보기로 보관돼요." : "변경하지 못했어요. 다시 시도해 주세요.");
    });
  };
  const hide = (n: ReceivedThankNote) => {
    if (!window.confirm("이 쪽지를 내 목록에서 숨길까요? 숨긴 쪽지는 다시 볼 수 없고, 공개 중이면 공개도 함께 내려가요. (보낸 분의 기록과 서비스 기록에서는 지워지지 않아요)")) return;
    startTransition(async () => {
      const r = await hideThankNoteAction(n.id);
      if (r.ok) setItems((all) => all.filter((x) => x.id !== n.id));
      else setError("숨기지 못했어요. 다시 시도해 주세요.");
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {items.map((n) => (
          <li key={n.id} className="flex flex-col gap-2 rounded-card border border-border bg-card p-4 text-sm">
            <p className="break-words whitespace-pre-line text-foreground">{n.body}</p>
            <p className="text-xs text-muted-foreground">
              {n.senderNickname ?? "이름 없음"} · {dateLabels[n.id]} ·{" "}
              <Link href={`/post/${n.postId}?type=${n.postType}`} className="underline-offset-2 hover:underline">
                {n.postTitle ?? "관련 게시글"}
              </Link>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${n.published ? "bg-primary-muted text-primary" : "bg-muted text-muted-foreground"}`}>{n.published ? "프로필에 공개 중" : "나만 보기"}</span>
              {n.personal && !n.published ? (
                <span className="text-xs text-muted-foreground">연락처·학번처럼 보이는 내용이 있어 공개할 수 없어요</span>
              ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => publish(n, !n.published)}
                className="min-h-9 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60"
              >
                {n.published ? "비공개로 바꾸기" : "프로필에 공개하기"}
              </button>
              )}
              <button type="button" disabled={pending} onClick={() => hide(n)} className="min-h-9 rounded-lg px-3 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60">
                목록에서 숨기기
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
