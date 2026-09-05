import path from "node:path";

// Type-only import: erased at compile time, so this never triggers the
// real (heavy) module load the way TransformersEmbeddingProvider's dynamic
// `import()` below does.
import type { FeatureExtractionPipeline } from "@huggingface/transformers";

// Server-only: TransformersEmbeddingProvider below pulls in
// @huggingface/transformers + onnxruntime-node (a native addon) and a
// 106MB model file. Never import this module from a "use client" file --
// same convention as src/lib/images/supabaseAdmin.ts (this project uses a
// documented boundary + code review, not the `server-only` npm package).
//
// ---------- Provider abstraction ----------
//
// The legacy Streamlit app (ai/embedding.py) encodes text with
// jhgan/ko-sroberta-multitask via the Python sentence-transformers
// library -- a 768-dim Korean sentence-transformer. Phase 5 verified (a
// real PoC, not just docs -- see docs/AI_MATCHING_ARCHITECTURE.md) that
// this exact model's official int8-quantized ONNX export runs directly
// inside a Node.js process via @huggingface/transformers: 768-dim output,
// ~10-15ms warm inference, ~230MB RSS. TransformersEmbeddingProvider below
// is that verified approach, now wired in for real. LexicalHashEmbeddingProvider
// (the placeholder every earlier phase ran on) is kept only as a fast,
// deterministic, model-free double for unit tests -- see embedding.test.ts.
export interface EmbeddingProvider {
  readonly name: string;
  embed(text: string): Promise<number[]>;
}

// jhgan/ko-sroberta-multitask's actual output size. Both providers below
// emit this many dimensions, so nothing downstream needs to branch on
// which provider produced a given vector.
export const EMBEDDING_DIMENSIONS = 768;

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
// download, no network call, no cold-start cost, runs in-process --
// exported for tests only now (see embedding.test.ts / matching.test.ts),
// not returned by getEmbeddingProvider() anymore.
//
// This is explicitly NOT a semantic embedding model. It captures
// character-level/lexical overlap, not meaning: "검은색 지갑" and "까만
// 지갑" (same meaning, different words) score lower here than they would
// under a real sentence-transformer.
export class LexicalHashEmbeddingProvider implements EmbeddingProvider {
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

// The real thing. `pipeline()` itself is expensive (loads and initializes
// an ONNX Runtime session) -- it's called at most once per process
// (module-level promise, not per-instance state), and every subsequent
// embed() in the same warm serverless instance reuses it. The promise
// (not just the resolved value) is cached so concurrent cold-start
// requests await the same in-flight load instead of racing to start
// their own.
export class TransformersEmbeddingProvider implements EmbeddingProvider {
  readonly name = "jhgan-ko-sroberta-multitask-onnx-q8";

  private static sessionPromise: Promise<FeatureExtractionPipeline> | undefined;

  private static getSession() {
    if (!this.sessionPromise) {
      this.sessionPromise = import("@huggingface/transformers").then(({ env, pipeline }) => {
        // A real Vercel deployment (Phase 6) proved transformers.js's
        // default behavior doesn't work there: it lazily downloads the
        // model on first use and writes it to a cache dir under
        // node_modules/@huggingface/transformers/.cache -- but Vercel
        // Functions have a read-only filesystem outside /tmp, so that
        // write fails ("ENOENT ... mkdir '/var/task/node_modules/
        // @huggingface/transformers/.cache'"). Fix: ship the model files
        // ourselves (models/jhgan/ko-sroberta-multitask/, copied from that
        // same cache dir after a one-time local run -- see
        // docs/AI_MATCHING_ARCHITECTURE.md) as a read-only local model,
        // and disable remote fetching entirely so it's never attempted.
        env.allowRemoteModels = false;
        env.localModelPath = path.join(process.cwd(), "models");
        return pipeline("feature-extraction", "jhgan/ko-sroberta-multitask", {
          // This repo predates transformers.js's naming convention (it's a
          // plain sentence-transformers ONNX export, not one of Xenova's
          // converted repos) -- model_file_name picks its actual quantized
          // file by name instead of the dtype-inferred default
          // ("model_quantized.onnx", which doesn't exist in this repo).
          model_file_name: "model_qint8_avx512_vnni",
          local_files_only: true,
        });
      });
    }
    return this.sessionPromise;
  }

  async embed(text: string): Promise<number[]> {
    const extractor = await TransformersEmbeddingProvider.getSession();
    // mean pooling + L2 normalization: the standard sentence-transformers
    // recipe (matches what the legacy Python sentence_transformers library
    // does internally for this same model), so cosine similarity between
    // two normalized vectors is just their dot product.
    const output = await extractor(text, { pooling: "mean", normalize: true });
    return Array.from(output.data as Float32Array);
  }
}

let defaultProvider: EmbeddingProvider | undefined;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (!defaultProvider) defaultProvider = new TransformersEmbeddingProvider();
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
