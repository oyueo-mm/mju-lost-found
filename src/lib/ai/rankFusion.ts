import type { CandidateCosines } from "./vectorSearch";

// AI 유사도 척도 통일 Phase: 게시글 상세 AI 추천과 AI 검색이 화면에 "AI 유사도
// 0.xx"로 보여주는 값, 그리고 텍스트+이미지 후보를 정렬하는 기준을 모두 이
// 모듈의 "D3" 절대 척도 하나로 통일한다. 이전 방식(Phase O-3/O-4의 후보 풀
// 내부 min-max 정규화 후 평균)은 신호 간 척도 차이는 없앴지만, 1위가 항상
// 1.000이 되는 상대점수라 "찾는 물건이 아예 없는" 경우에도 확신에 찬 점수를
// 보여줬다 -- docs/ai-eval-seed/baseline-2026-09-29.md 참고(No-match 10/10이
// 1.000으로 표시, 정답 vs No-match 1위 AUC 0.38).
//
// D3 정의: 신호별로 "서로 무관한 게시글끼리의 전형적인 cosine"을 0, 동일을 1로
// 두는 고정 선형 보정 후 [0, 1]로 자른다.
//   s_text  = clamp01((cos_text  - b_text)  / (1 - b_text))
//   s_image = clamp01((cos_image - b_image) / (1 - b_image))
//   AI 유사도 = 두 게시글(또는 검색어와 게시글) 모두에 해당 임베딩이 있는
//              신호만 평균 (하나만 있으면 그 신호만 사용).
// 확률이 아니라 유사도다 -- "이 물건일 확률 62%"로 읽히면 안 되므로 화면에서는
// 항상 소수 두 자리("AI 유사도 0.62")로만 보여준다(PostCard의 scoreDisplay
// 참고). 기준선은 신호별 고정 상수라 쿼리나 후보 목록이 바뀌어도 같은 쌍은
// 항상 같은 값을 받는다(절대 척도).
//
// 기준선 출처와 한계:
// - 2026-09-29 Preview AI 평가 데이터셋(게시글 99개, docs/ai-eval-seed/
//   score-scale-analysis-2026-09-29.json)에서 정답 쌍을 제외한 모든 분실물x
//   습득물 쌍의 cosine 중앙값이다: 텍스트(ko-sroberta) 2292쌍 -> 0.361,
//   이미지(SigLIP) 288쌍 -> 0.657.
// - 이미지 쌍은 코드로 그린 합성 이미지였다. 실제 사진의 무관한 쌍 분포는
//   다를 가능성이 크므로, 운영 데이터가 쌓이면 같은 방식(정답이 아닌 쌍의
//   중앙값)으로 다시 산정해야 한다. 임베딩 모델을 바꿔도 반드시 다시 산정한다.
// - 값을 바꾸면 AI_SIMILARITY_SCALE_ID가 함께 바뀌어 추천 캐시가 자동으로
//   무효화된다(recommendation/service.ts 참고).
export const AI_SIMILARITY_TEXT_BASELINE = 0.361;
export const AI_SIMILARITY_IMAGE_BASELINE = 0.657;

// Identifies the scale a cached ranking's scores were computed on -- see
// recommendation/service.ts's cache read, which treats any other value
// (including the pre-D3 relative-score rows, which carry none) as a miss.
export const AI_SIMILARITY_SCALE_ID = `d3:text=${AI_SIMILARITY_TEXT_BASELINE}:image=${AI_SIMILARITY_IMAGE_BASELINE}`;

export type RankedCandidate = { id: number; score: number };

function calibrate(cosine: number, baseline: number): number {
  return (cosine - baseline) / (1 - baseline);
}

type AiSimilarity = {
  // The displayed D3 value, in [0, 1].
  score: number;
  // The same mean before clamping -- only used to order candidates that
  // clamp to the same score (typically several at 0), so a weak-but-real
  // match isn't pushed out of the top K by an arbitrary id tie-break.
  unclamped: number;
};

// Returns null when neither signal is available (nothing to compare).
export function aiSimilarity(textCosine: number | null, imageCosine: number | null): AiSimilarity | null {
  const calibrated = [
    ...(textCosine === null ? [] : [calibrate(textCosine, AI_SIMILARITY_TEXT_BASELINE)]),
    ...(imageCosine === null ? [] : [calibrate(imageCosine, AI_SIMILARITY_IMAGE_BASELINE)]),
  ];
  if (calibrated.length === 0) return null;
  const clamped = calibrated.map((value) => Math.min(1, Math.max(0, value)));
  return {
    score: clamped.reduce((sum, value) => sum + value, 0) / clamped.length,
    unclamped: calibrated.reduce((sum, value) => sum + value, 0) / calibrated.length,
  };
}

// Sorts an already-chosen candidate pool by AI 유사도: D3 descending, then the
// unclamped mean descending, then id ascending. Callers choose the pool
// (text top-K ∪ image top-K) themselves; this never adds or drops a
// candidate that has at least one signal, and applies no threshold.
export function rankByAiSimilarity(candidates: CandidateCosines[]): RankedCandidate[] {
  return candidates
    .flatMap((candidate) => {
      const similarity = aiSimilarity(candidate.text, candidate.image);
      return similarity ? [{ id: candidate.id, ...similarity }] : [];
    })
    .sort((a, b) => b.score - a.score || b.unclamped - a.unclamped || a.id - b.id)
    .map(({ id, score }) => ({ id, score }));
}

// The candidate pool both callers rank: the union of the ids each signal's
// own top-K search returned, first-seen order (the order doesn't matter --
// rankByAiSimilarity() re-sorts it).
export function candidatePool(...rankings: { id: number }[][]): number[] {
  return [...new Set(rankings.flat().map((r) => r.id))];
}
