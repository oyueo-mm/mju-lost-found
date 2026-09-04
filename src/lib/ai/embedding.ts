// ---------- Provider abstraction ----------
//
// The legacy Streamlit app (ai/embedding.py) encodes text with
// jhgan/ko-sroberta-multitask via the Python sentence-transformers
// library -- a 768-dim Korean sentence-transformer that downloads a
// multi-hundred-MB model and needs a persistent Python/torch runtime to
// serve inference cheaply. That's fundamentally incompatible with a
// Vercel serverless Node.js function: no bundled Python runtime, no
// guaranteed writable/persistent disk for the model cache, a multi-second
// (or worse, out-of-memory) cold start on every function instance, and no
// way to "load once, reuse" across invocations the way a long-running
// server could. This has not been verified as production-viable and is
// not implemented here -- see LexicalHashEmbeddingProvider below for what
// runs instead, and the class comment for how to swap in a real hosted
// embedding API later without touching any caller.
export interface EmbeddingProvider {
  readonly name: string;
  embed(text: string): Promise<number[]>;
}

export const EMBEDDING_DIMENSIONS = 256;

// FNV-1a -- a small, fast, non-cryptographic hash, deterministic across
// runs/processes (unlike e.g. Node's default string hashing), which is
// what makes the resulting vector reproducible for the same text.
function hashToBucket(value: string, buckets: number): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash) % buckets;
}

// A dependency-free, deterministic *lexical* embedding: hashes character
// bigrams into a fixed-size count vector (the "hashing trick"). No model
// download, no network call, no cold-start cost, runs in-process -- this
// is what actually makes candidate ranking deployable today.
//
// This is explicitly NOT a semantic embedding model. It captures
// character-level/lexical overlap, not meaning: "검은색 지갑" and "까만
// 지갑" (same meaning, different words) score lower here than they would
// under a real sentence-transformer. Treat scores from this provider as a
// rough textual-similarity signal for surfacing candidates, not a
// meaning-aware AI judgment -- swapping in a real hosted embedding API
// (once one is chosen and its credentials are configured) only requires
// implementing this same EmbeddingProvider interface and changing
// getEmbeddingProvider() below; no caller (matching.ts, match/candidates.ts,
// the API route) needs to change.
class LexicalHashEmbeddingProvider implements EmbeddingProvider {
  readonly name = "lexical-hash-v1";

  async embed(text: string): Promise<number[]> {
    const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
    const normalized = text.trim().toLowerCase();
    if (normalized.length < 2) return vector;

    for (let i = 0; i < normalized.length - 1; i++) {
      const bucket = hashToBucket(normalized.slice(i, i + 2), EMBEDDING_DIMENSIONS);
      vector[bucket] += 1;
    }
    return vector;
  }
}

let defaultProvider: EmbeddingProvider | undefined;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (!defaultProvider) defaultProvider = new LexicalHashEmbeddingProvider();
  return defaultProvider;
}

// ---------- Text representation ----------

export type EmbeddableFields = {
  title?: string | null;
  description?: string | null;
  category?: string | null;
  location?: string | null;
};

// Mirrors the legacy ai/embedding.py::build_embedding_text() exactly:
// join title/description/category/location with a single space, skipping
// empty fields, into one coherent blob rather than four disconnected
// fields -- so a candidate that matches on category+location but not
// title still contributes to the overall similarity, and title-only or
// description-only text is never embedded on its own.
export function buildEmbeddingText(fields: EmbeddableFields): string {
  return [fields.title, fields.description, fields.category, fields.location]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(" ");
}
