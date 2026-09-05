import { beforeEach, describe, expect, it, vi } from "vitest";

import { IMAGE_EMBEDDING_DIMENSIONS } from "./imageEmbedding";

// Mirrors embedding.test.ts's TransformersEmbeddingProvider suite exactly:
// what's tested here is this class's own wiring (right model id, right
// dtype, session cached across calls, RawImage actually used to read the
// input, plain number[] output) -- never the real model's inference
// quality, which is verified separately against the real model (see
// docs/IMAGE_EMBEDDING_POC.md and this phase's real-Supabase verification).
const autoProcessorFromPretrained = vi.fn();
const siglipVisionModelFromPretrained = vi.fn();
const rawImageRead = vi.fn();

vi.mock("@huggingface/transformers", () => ({
  AutoProcessor: { from_pretrained: (...args: unknown[]) => autoProcessorFromPretrained(...args) },
  SiglipVisionModel: { from_pretrained: (...args: unknown[]) => siglipVisionModelFromPretrained(...args) },
  RawImage: { read: (...args: unknown[]) => rawImageRead(...args) },
  env: {},
}));

describe("TransformersImageEmbeddingProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  function mockPooledOutput(values: number[]) {
    const processor = vi.fn().mockResolvedValue({ pixel_values: "fake" });
    const model = vi.fn().mockResolvedValue({ pooler_output: { data: new Float32Array(values) } });
    autoProcessorFromPretrained.mockResolvedValue(processor);
    siglipVisionModelFromPretrained.mockResolvedValue(model);
    rawImageRead.mockResolvedValue({ fake: "image" });
    return { processor, model };
  }

  it("loads the processor+model once and reuses them across multiple embed() calls (session singleton)", async () => {
    mockPooledOutput(new Array(IMAGE_EMBEDDING_DIMENSIONS).fill(0.1));

    const { TransformersImageEmbeddingProvider } = await import("./imageEmbedding");
    const provider = new TransformersImageEmbeddingProvider();

    await provider.embed("https://storage.example/a.jpg");
    await provider.embed("https://storage.example/b.jpg");

    expect(autoProcessorFromPretrained).toHaveBeenCalledTimes(1);
    expect(siglipVisionModelFromPretrained).toHaveBeenCalledTimes(1);
    expect(siglipVisionModelFromPretrained).toHaveBeenCalledWith(
      "Xenova/siglip-base-patch16-224",
      expect.objectContaining({ dtype: "q8", local_files_only: true }),
    );
  });

  it("shares the same session across separate provider instances (module-level cache, not per-instance)", async () => {
    mockPooledOutput(new Array(IMAGE_EMBEDDING_DIMENSIONS).fill(0.1));

    const { TransformersImageEmbeddingProvider } = await import("./imageEmbedding");
    await new TransformersImageEmbeddingProvider().embed("https://storage.example/a.jpg");
    await new TransformersImageEmbeddingProvider().embed("https://storage.example/b.jpg");

    expect(siglipVisionModelFromPretrained).toHaveBeenCalledTimes(1);
  });

  it("disables remote fetching and points at the locally-bundled model directory", async () => {
    mockPooledOutput(new Array(IMAGE_EMBEDDING_DIMENSIONS).fill(0.1));
    const { env } = await import("@huggingface/transformers");

    const { TransformersImageEmbeddingProvider } = await import("./imageEmbedding");
    await new TransformersImageEmbeddingProvider().embed("https://storage.example/a.jpg");

    expect(env.allowRemoteModels).toBe(false);
    expect(env.localModelPath).toContain("models");
  });

  it("reads the input via RawImage.read(imageUrl) -- accepts a plain URL string", async () => {
    mockPooledOutput(new Array(IMAGE_EMBEDDING_DIMENSIONS).fill(0.1));

    const { TransformersImageEmbeddingProvider } = await import("./imageEmbedding");
    await new TransformersImageEmbeddingProvider().embed("https://storage.example/post-images/a.jpg");

    expect(rawImageRead).toHaveBeenCalledWith("https://storage.example/post-images/a.jpg");
  });

  it("returns a plain, L2-normalized number[] of the declared dimensionality", async () => {
    mockPooledOutput([3, 4]); // 3-4-5 triangle -> norm 5, easy to check by hand

    const { TransformersImageEmbeddingProvider } = await import("./imageEmbedding");
    const vector = await new TransformersImageEmbeddingProvider().embed("https://storage.example/a.jpg");

    expect(Array.isArray(vector)).toBe(true);
    expect(vector).toEqual([expect.closeTo(0.6, 5), expect.closeTo(0.8, 5)]);
  });

  it("propagates a RawImage.read() failure (invalid/unreachable image) instead of swallowing it", async () => {
    autoProcessorFromPretrained.mockResolvedValue(vi.fn());
    siglipVisionModelFromPretrained.mockResolvedValue(vi.fn());
    rawImageRead.mockRejectedValue(new Error("Unable to read image from url (404 Not Found)"));

    const { TransformersImageEmbeddingProvider } = await import("./imageEmbedding");

    await expect(
      new TransformersImageEmbeddingProvider().embed("https://storage.example/missing.jpg"),
    ).rejects.toThrow("404 Not Found");
  });
});
