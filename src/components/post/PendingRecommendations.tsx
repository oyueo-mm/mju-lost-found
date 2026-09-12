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
export const MAX_POLL_ATTEMPTS = 3;

// 첫 게시글 AI 추천 무한 로딩 버그 수정: 이 결정 하나가 "스피너를 계속
// 보여줄지"를 정하는 유일한 지점이라 별도의 순수 함수로 뽑아 테스트했다
// (이 프로젝트에는 컴포넌트/훅 렌더링 테스트 도구(@testing-library 등)가
// 전혀 설치돼 있지 않아 -- vitest.config.ts의 environment: "node" 참고 --
// useEffect 자체를 직접 렌더링해 검증할 수는 없다. 대신 실제 버그였던
// "결과 0개 상태가 attempt가 올라가도 언제 실제로 멈추는가"라는 종료
// 조건 자체를 여기서 고정한다):
//   추천 있음(recommendationCount > 0)      -> false (즉시 로딩 종료)
//   오류(failed)                             -> false (즉시 로딩 종료)
//   추천 없음 + 아직 재시도 예산 남음         -> true  (계속 polling)
//   추천 없음 + 재시도 예산 소진(3회)         -> false (loading 종료 + empty state)
export function shouldKeepPolling({
  pollForResults,
  recommendationCount,
  failed,
  attempt,
}: {
  pollForResults: boolean;
  recommendationCount: number;
  failed: boolean;
  attempt: number;
}): boolean {
  return pollForResults && recommendationCount === 0 && !failed && attempt < MAX_POLL_ATTEMPTS;
}

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
  const stillWaiting = shouldKeepPolling({
    pollForResults,
    recommendationCount: recommendations.length,
    failed,
    attempt,
  });

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
      // 첫 게시글 AI 추천 무한 로딩 버그 수정: 이 effect의 의존성 배열이
      // 예전에는 [stillWaiting, sourceId, sourceType]뿐이었다 -- 추천이
      // 계속 0개인 상태로 남아 있는 동안 `stillWaiting`은 매 attempt마다
      // 계속 true -> true로(값 자체는 안 바뀜) 유지되므로, attempt가
      // 0에서 1로 올라가도 React가 "의존성이 안 바뀌었다"고 보고 이
      // effect를 다시 실행하지 않았다 -- 즉 최초 1회 poll 이후로는 두
      // 번째 setTimeout이 다시는 예약되지 않고, attempt는 1에서 영원히
      // 멈춘 채 stillWaiting(=pending)만 계속 true로 남아 스피너가
      // 끝없이 도는 것이 실제 원인이었다. attempt를 의존성에 추가하면
      // attempt가 바뀔 때마다(추천이 여전히 0개라도) 이 effect가 다시
      // 실행되어 다음 poll을 정상적으로 예약하고, MAX_POLL_ATTEMPTS에
      // 도달하면(stillWaiting이 비로소 false가 되어) 정상적으로 멈춘다.
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [stillWaiting, sourceId, sourceType, attempt]);

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
