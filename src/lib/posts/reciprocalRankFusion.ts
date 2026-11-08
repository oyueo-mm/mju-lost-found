export const DEFAULT_RRF_K = 60;

export function reciprocalRankFusion<T>(
  rankings: readonly { items: readonly T[]; weight?: number }[],
  { key, tieBreak, k = DEFAULT_RRF_K }: { key: (item: T) => string; tieBreak: (a: T, b: T) => number; k?: number },
): { item: T; score: number }[] {
  if (!Number.isFinite(k) || k < 0) throw new Error("RRF k must be finite and non-negative");
  const fused = new Map<string, { item: T; score: number }>();
  for (const { items, weight = 1 } of rankings) {
    if (!Number.isFinite(weight) || weight < 0) throw new Error("RRF weights must be finite and non-negative");
    const seen = new Set<string>();
    let rank = 0;
    for (const item of items) {
      const id = key(item);
      if (seen.has(id)) continue;
      seen.add(id);
      rank++;
      const entry = fused.get(id) ?? { item, score: 0 };
      entry.score += weight / (k + rank);
      fused.set(id, entry);
    }
  }
  return [...fused.values()].sort((a, b) => b.score - a.score || tieBreak(a.item, b.item) || key(a.item).localeCompare(key(b.item)));
}
