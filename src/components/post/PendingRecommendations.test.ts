import { describe, expect, it } from "vitest";

import { MAX_POLL_ATTEMPTS, shouldKeepPolling } from "./PendingRecommendations";

// 첫 게시글 AI 추천 무한 로딩 버그 수정 Phase: this project has no
// component/hook-rendering test tooling (vitest.config.ts's environment is
// "node", no @testing-library installed), so PendingRecommendations'
// useEffect polling loop itself can't be rendered and driven directly here.
// What actually decides whether the "AI 추천을 준비하고 있어요" spinner
// keeps showing is shouldKeepPolling() -- these tests pin its three
// required end states (추천 있음/추천 없음/오류) plus the exact attempt
// boundary the real bug was in (attempt never advancing past the point
// where stillWaiting's *value* stopped changing between renders).
describe("shouldKeepPolling", () => {
  it("stops immediately once a recommendation has arrived (추천 있음 → loading 종료)", () => {
    expect(
      shouldKeepPolling({ pollForResults: true, recommendationCount: 1, failed: false, attempt: 0 }),
    ).toBe(false);
  });

  it("stops immediately on a real failure, regardless of attempt count (오류 → loading 종료 + error state)", () => {
    expect(
      shouldKeepPolling({ pollForResults: true, recommendationCount: 0, failed: true, attempt: 0 }),
    ).toBe(false);
  });

  it("keeps polling while results are still empty and the retry budget isn't exhausted", () => {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      expect(
        shouldKeepPolling({ pollForResults: true, recommendationCount: 0, failed: false, attempt }),
      ).toBe(true);
    }
  });

  it("stops once the retry budget is exhausted, even though results are still empty (추천 없음 → loading 종료 + empty state)", () => {
    expect(
      shouldKeepPolling({
        pollForResults: true,
        recommendationCount: 0,
        failed: false,
        attempt: MAX_POLL_ATTEMPTS,
      }),
    ).toBe(false);
  });

  it("never polls at all outside the just-created redirect (pollForResults=false)", () => {
    expect(
      shouldKeepPolling({ pollForResults: false, recommendationCount: 0, failed: false, attempt: 0 }),
    ).toBe(false);
  });
});
