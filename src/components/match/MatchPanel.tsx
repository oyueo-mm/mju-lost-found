"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { PostType } from "@/lib/posts/schema";

type CounterpartSummary = { id: number; title: string; imageUrl: string | null };
type MatchRow = { id: number; counterpart: CounterpartSummary };
type AiCandidate = {
  postId: number;
  type: PostType;
  score: number;
  title: string;
  category: string;
  location: string;
  imageUrl: string | null;
};

type MatchPanelProps = {
  postType: PostType; // the type of the post being viewed (the owner's own post)
  postId: number;
  initialMatches: MatchRow[];
};

// Only ever rendered for the post's owner (see /post/[id]/page.tsx) --
// the API still re-checks ownership itself regardless (createMatch/
// deleteMatch/findMatchCandidates), this is just the UI entry point,
// matching the legacy "내 물건 같아요" button pattern with AI-ranked
// candidates (GET /api/posts/[id]/matches/candidates) standing in for the
// legacy Streamlit page's AI candidate list.
export function MatchPanel({ postType, postId, initialMatches }: MatchPanelProps) {
  const router = useRouter();
  const [matches, setMatches] = useState(initialMatches);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);

  const [candidates, setCandidates] = useState<AiCandidate[] | null>(null);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadCandidates() {
      setCandidatesError(null);
      try {
        const res = await fetch(`/api/posts/${postId}/matches/candidates?type=${postType}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setCandidatesError(json.error ?? "AI 매칭 후보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
          return;
        }
        setCandidates(json.data);
      } catch {
        if (!cancelled) {
          setCandidatesError("AI 매칭 후보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
        }
      }
    }

    loadCandidates();
    return () => {
      cancelled = true;
    };
  }, [postType, postId]);

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

  async function handleOpenChat(matchId: number) {
    if (pendingId !== null) return;
    setPendingId(matchId);
    setError(null);

    try {
      // Idempotent -- calling this again for a match that already has a
      // room just returns that same room (see getOrCreateChatRoomForMatch),
      // never creates a second one, including under concurrent clicks.
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "채팅방을 여는 데 실패했습니다.");
        return;
      }
      router.push(`/chat/${json.data.id}`);
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

  const candidateType: PostType = postType === "lost" ? "found" : "lost";
  const unmatchedCandidates = (candidates ?? []).filter((c) => !matchedIds.has(c.postId));

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
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleOpenChat(m.id)}
                  disabled={pendingId !== null}
                  className="rounded-full border border-zinc-300 px-3 py-1 text-xs hover:border-zinc-400 disabled:opacity-60 dark:border-zinc-700 dark:hover:border-zinc-600"
                >
                  {pendingId === m.id ? "여는 중..." : "채팅하기"}
                </button>
                <button
                  type="button"
                  onClick={() => handleCancel(m.id)}
                  disabled={pendingId !== null}
                  className="text-red-600 underline disabled:opacity-60 dark:text-red-400"
                >
                  {pendingId === m.id ? "취소 중..." : "매칭 해제"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-sm text-zinc-500 dark:text-zinc-400">AI 매칭 후보</span>

        {candidatesError ? (
          <p className="text-sm text-red-600 dark:text-red-400">{candidatesError}</p>
        ) : candidates === null ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-500">후보를 불러오는 중...</p>
        ) : unmatchedCandidates.length === 0 ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-500">추천할 후보가 없습니다.</p>
        ) : (
          unmatchedCandidates.map((c) => (
            <div
              key={c.postId}
              className="flex items-center justify-between gap-3 rounded-md border border-dashed border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate">{c.title}</span>
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  {c.category} · {c.location} · 유사도 {Math.round(c.score * 100)}%
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={`/post/${c.postId}?type=${candidateType}`}
                  className="rounded-full border border-zinc-300 px-3 py-1 text-xs hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600"
                >
                  게시물 보기
                </Link>
                <button
                  type="button"
                  onClick={() => handleConfirm(c.postId)}
                  disabled={pendingId !== null}
                  className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900"
                >
                  {pendingId === c.postId ? "확정 중..." : "매칭하기"}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
