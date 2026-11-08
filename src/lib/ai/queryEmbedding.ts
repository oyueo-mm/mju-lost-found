import { createHash } from "node:crypto";
import { getEmbeddingProvider } from "./embedding";

// Cache vectors, never post results/visibility decisions. Bounded and warm-
// process only: pagination/filter changes can reuse a query vector while
// every request still checks current public rows. No raw query cache keys.
const TTL_MS = 120_000;
const MAX_ENTRIES = 64;
const vectors = new Map<string, { until: number; value: Promise<number[]> }>();

export function queryEmbedding(query: string): Promise<number[]> {
  const key = createHash("sha256").update(query.trim()).digest("hex");
  const now = Date.now();
  const cached = vectors.get(key);
  if (cached && cached.until > now) return cached.value;
  vectors.delete(key);
  for (const [id, entry] of vectors) if (entry.until <= now) vectors.delete(id);
  if (vectors.size >= MAX_ENTRIES) vectors.delete(vectors.keys().next().value!);
  const value = Promise.resolve().then(() => getEmbeddingProvider().embed(query.trim()));
  const entry = { until: now + TTL_MS, value };
  vectors.set(key, entry);
  void value.catch(() => { if (vectors.get(key) === entry) vectors.delete(key); });
  return value;
}
