import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildEmbeddingText,
  EMBEDDING_DIMENSIONS,
  LexicalHashEmbeddingProvider,
} from "./embedding";

describe("buildEmbeddingText", () => {
  it("includes title, description, category, and location", () => {
    const text = buildEmbeddingText({
      title: "검은색 에어팟 프로",
      description: "도서관 3층에서 잃어버렸습니다",
      category: "전자기기",
      location: "명지대학교 도서관",
    });

    expect(text).toContain("검은색 에어팟 프로");
    expect(text).toContain("도서관 3층에서 잃어버렸습니다");
    expect(text).toContain("전자기기");
    expect(text).toContain("명지대학교 도서관");
  });

  it("builds text from title alone when nothing else is given", () => {
    expect(buildEmbeddingText({ title: "지갑" })).toBe("지갑");
  });

  it("builds text from description alone when nothing else is given", () => {
    expect(buildEmbeddingText({ description: "검은색 가죽 지갑을 잃어버렸어요" })).toBe(
      "검은색 가죽 지갑을 잃어버렸어요",
    );
  });

  it("skips empty/missing fields instead of inserting blank tokens", () => {
    const text = buildEmbeddingText({ title: "지갑", description: "", category: undefined, location: "학생회관" });
    expect(text).toBe("지갑 학생회관");
    expect(text).not.toContain("  "); // no doubled-up separator from a skipped field
  });

  it("returns an empty string when every field is empty", () => {
    expect(buildEmbeddingText({})).toBe("");
  });
});

// LexicalHashEmbeddingProvider is no longer what getEmbeddingProvider()
// returns (that's TransformersEmbeddingProvider now -- see below), but it's
// kept as a fast, deterministic, model-free double: exercised directly
// here, and by any test elsewhere that needs a real (if not semantic)
// EmbeddingProvider without paying for a 106MB ONNX model load.
describe("LexicalHashEmbeddingProvider", () => {
  it("returns a vector of the declared dimensionality", async () => {
    const provider = new LexicalHashEmbeddingProvider();
    const vector = await provider.embed("검은색 지갑");
    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it("is deterministic -- the same text always embeds to the same vector", async () => {
    const provider = new LexicalHashEmbeddingProvider();
    const a = await provider.embed("검은색 지갑을 학생회관에서 잃어버렸습니다");
    const b = await provider.embed("검은색 지갑을 학생회관에서 잃어버렸습니다");
    expect(a).toEqual(b);
  });

  it("produces different vectors for clearly different text", async () => {
    const provider = new LexicalHashEmbeddingProvider();
    const a = await provider.embed("검은색 지갑을 학생회관에서 잃어버렸습니다");
    const b = await provider.embed("아이폰 15 프로 명지대 도서관에서 습득");
    expect(a).not.toEqual(b);
  });

  it("returns an all-zero vector for empty text rather than throwing", async () => {
    const provider = new LexicalHashEmbeddingProvider();
    const vector = await provider.embed("");
    expect(vector.every((v) => v === 0)).toBe(true);
  });
});

// TransformersEmbeddingProvider's own inference quality (does the real
// jhgan/ko-sroberta-multitask model produce good embeddings?) is verified
// separately, against the real model, outside this fast unit-test suite --
// see docs/AI_MATCHING_ARCHITECTURE.md's PoC section and the Phase 6
// report. What's tested here is this class's own wiring: does it call the
// pipeline with the right arguments, cache the session across calls
// (never reloading per-request), and return a plain number[] of the
// pooled/normalized output -- all without ever downloading or running the
// actual model.
const pipelineFactory = vi.fn();
vi.mock("@huggingface/transformers", () => ({
  pipeline: (...args: unknown[]) => pipelineFactory(...args),
  env: {},
}));

describe("TransformersEmbeddingProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("loads the pipeline once and reuses it across multiple embed() calls", async () => {
    const extractor = vi.fn().mockResolvedValue({ data: new Float32Array(EMBEDDING_DIMENSIONS) });
    pipelineFactory.mockResolvedValue(extractor);

    const { TransformersEmbeddingProvider } = await import("./embedding");
    const provider = new TransformersEmbeddingProvider();

    await provider.embed("첫 번째 문장");
    await provider.embed("두 번째 문장");

    expect(pipelineFactory).toHaveBeenCalledTimes(1);
    expect(pipelineFactory).toHaveBeenCalledWith(
      "feature-extraction",
      "jhgan/ko-sroberta-multitask",
      expect.objectContaining({
        model_file_name: "model_qint8_avx512_vnni",
        local_files_only: true,
      }),
    );
    expect(extractor).toHaveBeenCalledTimes(2);
    expect(extractor).toHaveBeenCalledWith("첫 번째 문장", { pooling: "mean", normalize: true });
  });

  // A real Vercel deployment (Phase 6) proved the library's default
  // behavior -- fetch the model on first use, cache it under
  // node_modules/@huggingface/transformers/.cache -- fails there (the
  // function's filesystem is read-only outside /tmp). This locks in the
  // fix: never touch the network, read the pre-bundled copy under
  // models/ instead (see next.config.ts's outputFileTracingIncludes).
  it("disables remote fetching and points at the locally-bundled model directory", async () => {
    const extractor = vi.fn().mockResolvedValue({ data: new Float32Array(EMBEDDING_DIMENSIONS) });
    pipelineFactory.mockResolvedValue(extractor);
    const { env } = await import("@huggingface/transformers");

    const { TransformersEmbeddingProvider } = await import("./embedding");
    await new TransformersEmbeddingProvider().embed("텍스트");

    expect(env.allowRemoteModels).toBe(false);
    expect(env.localModelPath).toContain("models");
  });

  it("shares the same session across separate provider instances (module-level cache, not per-instance)", async () => {
    const extractor = vi.fn().mockResolvedValue({ data: new Float32Array(EMBEDDING_DIMENSIONS) });
    pipelineFactory.mockResolvedValue(extractor);

    const { TransformersEmbeddingProvider } = await import("./embedding");
    await new TransformersEmbeddingProvider().embed("a");
    await new TransformersEmbeddingProvider().embed("b");

    expect(pipelineFactory).toHaveBeenCalledTimes(1);
  });

  it("returns a plain number[] (not a typed array) of the pipeline's output", async () => {
    const raw = new Float32Array([0.1, 0.2, 0.3]);
    pipelineFactory.mockResolvedValue(vi.fn().mockResolvedValue({ data: raw }));

    const { TransformersEmbeddingProvider } = await import("./embedding");
    const vector = await new TransformersEmbeddingProvider().embed("텍스트");

    expect(Array.isArray(vector)).toBe(true);
    expect(vector).toEqual([
      expect.closeTo(0.1, 5),
      expect.closeTo(0.2, 5),
      expect.closeTo(0.3, 5),
    ]);
  });
});
