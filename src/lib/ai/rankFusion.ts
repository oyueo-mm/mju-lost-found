import type { VectorSearchResult } from "./vectorSearch";

// AI 검색 고도화 Phase: src/lib/recommendation/service.ts가 이미 갖고 있던
// text+image 결합 랭킹 로직(Phase O-3/O-4)을 그대로 이 공용 모듈로 옮겼다 --
// 새 weighting/threshold를 만들지 않고, 게시글 상세 AI 추천이 이미 검증해온
// 그대로의 알고리즘을 AI 검색(src/lib/posts/aiService.ts)에서도 재사용하기
// 위함이다. 로직 자체는 한 글자도 바뀌지 않았다.

// Phase O-3 found that text and image cosine similarity sit on different
// absolute scales (image's baseline runs consistently higher and narrower
// than text's, regardless of actual relevance -- see docs/AI recommendation
// quality analysis), so a plain average of the two raw scores structurally
// favors any candidate that happens to have an image, independent of how
// relevant it actually is. Min-max normalizing each signal across the
// current candidate union before averaging removes that scale bias without
// introducing a hand-picked weight (Phase O-4 constraint).
export function minMaxNormalize(scoresById: Map<number, number>): Map<number, number> {
  const values = [...scoresById.values()];
  const min = Math.min(...values);
  const max = Math.max(...values);
  // All candidates tied on this signal -- it carries no discriminating
  // information for this ranking, so it shouldn't drag anyone down (an
  // arbitrary 0 would look like "worst possible", which isn't true here).
  // Treating every candidate as equally maximal keeps the signal neutral.
  if (max === min) return new Map([...scoresById.keys()].map((id) => [id, 1]));
  return new Map([...scoresById.entries()].map(([id, score]) => [id, (score - min) / (max - min)]));
}

export type RankedCandidate = { id: number; score: number };

// Phase J-2 section 6 / Phase O-4: combines a candidate's text score and
// image score by averaging their normalized values when both are present,
// or uses whichever single (raw) score is present otherwise -- "존재하는
// 신호만 사용" (no candidate is penalized for a signal it never had a chance
// to have, e.g. a post with no image). Normalization runs over the final
// candidate union (both signals' pooled ids), not each signal's own
// independent ranking, so a candidate's normalized score reflects how it
// compares to the other candidates actually being ranked alongside it here.
//
// Callers: recommendation/service.ts (source post -> opposite-board
// candidates) and posts/aiService.ts's searchPostsAI (a raw text+image
// query -> one board's candidates) both pass their own text/image
// VectorSearchResult[] pairs into this exact same function -- neither
// caller has its own copy of this math.
export function combineRankings(text: VectorSearchResult[], image: VectorSearchResult[]): RankedCandidate[] {
  const textById = new Map(text.map((r) => [r.id, r.score]));
  const imageById = new Map(image.map((r) => [r.id, r.score]));
  const normalizedText = textById.size > 0 ? minMaxNormalize(textById) : textById;
  const normalizedImage = imageById.size > 0 ? minMaxNormalize(imageById) : imageById;

  const allIds = new Set([...textById.keys(), ...imageById.keys()]);
  return [...allIds]
    .map((id) => {
      const scores = [normalizedText.get(id), normalizedImage.get(id)].filter(
        (s): s is number => s !== undefined,
      );
      return { id, score: scores.reduce((sum, s) => sum + s, 0) / scores.length };
    })
    .sort((a, b) => b.score - a.score || a.id - b.id);
}
