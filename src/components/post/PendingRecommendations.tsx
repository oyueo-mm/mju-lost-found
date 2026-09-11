"use client";

import { useEffect, useState } from "react";

import type { PostType } from "@/lib/posts/schema";
import type { PostDTO } from "@/lib/posts/service";
import { reviveDates } from "@/lib/posts/reviveDates";
import { SimilarPostsSection } from "./SimilarPostsSection";

type PendingRecommendationsProps = {
  sourceType: PostType;
  sourceId: number;
  initialRecommendations: PostDTO[];
  initialFailed: boolean;
  // Only a fresh "게시글이 등록되었습니다" redirect turns polling on (see
  // post/[id]/page.tsx's own `created` search param) -- a normal page
  // view (or revisiting the same post later) renders this exactly like a
  // plain SimilarPostsSection, no fetch ever happens. This deliberately
  // does NOT introduce a queue/background-job system (out of this
  // phase's scope) -- just a few client-side retries against the same
  // recommendation logic the page itself already runs on render.
  pollForResults: boolean;
};

const POLL_INTERVAL_MS = 2000;
// A brand-new post's embedding is computed in the background (see
// aiService.ts's createLostPost/createFoundPost -- deferred via
// next/server's after(), so it isn't necessarily done by the time this
// page's very first render already ran). This app's own measured
// semantic-search latency (~4.68s cold, ~2.41s warm) is the closest real
// number available for how long that kind of inference call takes -- 3
// attempts at 2s apart covers that range without polling indefinitely.
const MAX_POLL_ATTEMPTS = 3;

export function PendingRecommendations({
  sourceType,
  sourceId,
  initialRecommendations,
  initialFailed,
  pollForResults,
}: PendingRecommendationsProps) {
  const [recommendations, setRecommendations] = useState(initialRecommendations);
  const [attempt, setAttempt] = useState(0);

  // Never re-set after mount -- a poll attempt that fails just counts
  // toward the retry budget (see the catch block below), it never flips
  // this to true. Only the initial server render can produce a real
  // failure state.
  const failed = initialFailed;
  const stillWaiting = pollForResults && recommendations.length === 0 && !failed && attempt < MAX_POLL_ATTEMPTS;

  useEffect(() => {
    if (!stillWaiting) return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/posts/${sourceId}?type=${sourceType}&include=recommendations`, {
          cache: "no-store",
        });
        if (res.ok) {
          const json = await res.json();
          const fresh: unknown[] = json.data?.recommendations ?? [];
          if (fresh.length > 0) {
            setRecommendations(fresh.map((item) => reviveDates(item as Record<string, unknown>)));
          }
        }
      } catch {
        // Best-effort -- a failed poll attempt just counts toward the
        // retry budget below (via the `finally`), never shows as an
        // error banner. The initial server-rendered `initialFailed` is
        // the only thing that can put this section into the real
        // "불러오는 중 문제가 발생했습니다" state.
      } finally {
        setAttempt((n) => n + 1);
      }
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [stillWaiting, sourceId, sourceType]);

  return (
    <SimilarPostsSection
      sourceType={sourceType}
      recommendations={recommendations}
      loadFailed={failed}
      pending={stillWaiting}
      // AI 검색 고도화 Phase: hides the score badge for the entire
      // "분실물/습득물 작성 직후" view (pollForResults=true), not just
      // while stillWaiting -- once the polled recommendations arrive,
      // pollForResults stays true for the rest of this same page load, so
      // the score stays hidden there too (spec: "분실물 작성 직후
      // 자동으로 표시되는 AI 추천에는 점수를 표시하지 않는다"). A later,
      // ordinary revisit to the same post (pollForResults=false from the
      // start) always shows the score.
      showScore={!pollForResults}
    />
  );
}
