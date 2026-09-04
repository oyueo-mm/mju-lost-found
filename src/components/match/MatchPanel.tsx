"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { PostType } from "@/lib/posts/schema";

type CounterpartSummary = { id: number; title: string; imageUrl: string | null };
type MatchRow = { id: number; counterpart: CounterpartSummary };

type MatchPanelProps = {
  postType: PostType; // the type of the post being viewed (the owner's own post)
  postId: number;
  initialMatches: MatchRow[];
  candidates: CounterpartSummary[]; // recent posts of the opposite board
};

// Only ever rendered for the post's owner (see /post/[id]/page.tsx) --
// the API still re-checks ownership itself regardless (createMatch/
// deleteMatch in src/lib/match/service.ts), this is just the UI entry
// point for it, matching the legacy "내 물건 같아요" button pattern minus
// the AI-ranked candidate list (candidates here are just recent posts of
// the opposite board; a later phase can swap this list for an AI one
// without changing the confirm/cancel flow itself).
export function MatchPanel({ postType, postId, initialMatches, candidates }: MatchPanelProps) {
  const router = useRouter();
  const [matches, setMatches] = useState(initialMatches);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);

  const matchedIds = new Set(matches.map((m) => m.counterpart.id));

  async function handleConfirm(candidateId: number) {
    if (pendingId !== null) return; // one in-flight request at a time -- no duplicate submits
    setPendingId(candidateId);
    setError(null);

    const body =
      postType === "lost"
        ? { lostPostId: postId, foundPostId: candidateId }
        : { lostPostId: candidateId, foundPostId: postId };

    try {
      const res = await fetch("/api/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "매칭을 확정하지 못했습니다.");
        return;
      }
      const counterpart = postType === "lost" ? json.data.foundPost : json.data.lostPost;
      setMatches((prev) => [...prev, { id: json.data.id, counterpart }]);
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setPendingId(null);
    }
  }

  async function handleCancel(matchId: number) {
    if (pendingId !== null) return;
    setPendingId(matchId);
    setError(null);

    try {
      const res = await fetch(`/api/matches/${matchId}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "매칭을 취소하지 못했습니다.");
        return;
      }
      setMatches((prev) => prev.filter((m) => m.id !== matchId));
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setPendingId(null);
    }
  }

  const unmatchedCandidates = candidates.filter((c) => !matchedIds.has(c.id));

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="font-medium text-zinc-900 dark:text-zinc-50">
        {postType === "lost" ? "습득물과 매칭하기" : "분실물과 매칭하기"}
      </h2>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {matches.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-sm text-zinc-500 dark:text-zinc-400">매칭된 게시물</span>
          {matches.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"
            >
              <span>{m.counterpart.title}</span>
              <button
                type="button"
                onClick={() => handleCancel(m.id)}
                disabled={pendingId !== null}
                className="text-red-600 underline disabled:opacity-60 dark:text-red-400"
              >
                {pendingId === m.id ? "취소 중..." : "매칭 해제"}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          {postType === "lost" ? "최근 습득물" : "최근 분실물"}
        </span>
        {unmatchedCandidates.length === 0 ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-500">표시할 게시물이 없습니다.</p>
        ) : (
          unmatchedCandidates.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between rounded-md border border-dashed border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
            >
              <span>{c.title}</span>
              <button
                type="button"
                onClick={() => handleConfirm(c.id)}
                disabled={pendingId !== null}
                className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900"
              >
                {pendingId === c.id ? "확정 중..." : "매칭하기"}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
