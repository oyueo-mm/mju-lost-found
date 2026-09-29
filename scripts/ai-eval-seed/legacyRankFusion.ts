// Verbatim copy of the pre-D3 src/lib/ai/rankFusion.ts combineRankings()
// (Phase O-3/O-4 in-pool min-max normalize, then average), kept only so
// the 2026-09-29 "before" analyses (analyze-score-scale.ts,
// compare-d3-ranking.ts) stay reproducible. The app no longer uses this.
type VectorSearchResult = { id: number; score: number };

function minMaxNormalize(scoresById: Map<number, number>): Map<number, number> {
  const values = [...scoresById.values()];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return new Map([...scoresById.keys()].map((id) => [id, 1]));
  return new Map([...scoresById.entries()].map(([id, score]) => [id, (score - min) / (max - min)]));
}

export function combineRankings(text: VectorSearchResult[], image: VectorSearchResult[]): VectorSearchResult[] {
  const textById = new Map(text.map((r) => [r.id, r.score]));
  const imageById = new Map(image.map((r) => [r.id, r.score]));
  const normalizedText = textById.size > 0 ? minMaxNormalize(textById) : textById;
  const normalizedImage = imageById.size > 0 ? minMaxNormalize(imageById) : imageById;

  const allIds = new Set([...textById.keys(), ...imageById.keys()]);
  return [...allIds]
    .map((id) => {
      const scores = [normalizedText.get(id), normalizedImage.get(id)].filter((s): s is number => s !== undefined);
      return { id, score: scores.reduce((sum, s) => sum + s, 0) / scores.length };
    })
    .sort((a, b) => b.score - a.score || a.id - b.id);
}
