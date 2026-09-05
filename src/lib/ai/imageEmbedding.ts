import path from "node:path";

// Server-only: pulls in @huggingface/transformers + onnxruntime-node (a
// native addon) and a ~99MB ONNX file, same boundary rule as
// src/lib/ai/embedding.ts and src/lib/images/supabaseAdmin.ts.
//
// ---------- Provider abstraction ----------
//
// Deliberately a *separate* module/interface from embedding.ts's
// EmbeddingProvider, not a shared one with an extra parameter -- text and
// image embeddings are different vector spaces (different model,
// different dimension semantics), stored in different DB columns
// (LostPost/FoundPost.imageEmbedding, never the existing .embedding), and
// never compared to each other. Sharing one interface would only invite
// accidentally mixing the two.
//
// Phase 15-1's PoC compared CLIP ViT-B/32 against SigLIP base-patch16-224
// with real photos (docs/IMAGE_EMBEDDING_POC.md): SigLIP showed a cleaner
// "same item > same category, different item > visually-similar-but-
// different-category > unrelated" separation, and -- decisively -- ships
// under Apache-2.0 (confirmed via the Hugging Face API's cardData.license
// field) where CLIP's own model card states "Any deployed use case of the
// model - whether commercial or not - is currently out of scope." SigLIP
// is the only one of the two viable for a real deployed service.
export interface ImageEmbeddingProvider {
  readonly name: string;
  embed(imageUrl: string): Promise<number[]>;
}

// Xenova/siglip-base-patch16-224's vision tower output size (SiglipVisionModel's
// pooler_output). Verified with a real PoC (docs/IMAGE_EMBEDDING_POC.md),
// not assumed from the model card alone.
export const IMAGE_EMBEDDING_DIMENSIONS = 768;

function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}

// The real thing. Mirrors TransformersEmbeddingProvider (embedding.ts)
// exactly: module-level cached session promise (never per-instance, never
// reloaded on a warm invocation), `env.allowRemoteModels = false` +
// `env.localModelPath` pointed at the build-time-downloaded copy under
// models/ (see scripts/downloadModel.mjs), `local_files_only: true` so a
// missing/stale file fails loudly instead of silently trying the network
// (which would fail anyway on Vercel's read-only filesystem -- see
// embedding.ts's own comment for the Phase 6 story behind that rule).
//
// dtype MUST be "q8" (not "quantized") to actually select
// onnx/vision_model_quantized.onnx -- @huggingface/transformers' own dtype
// enum maps "q8" -> "_quantized" and silently falls back to the full fp32
// weights (~372MB, not the ~99MB quantized file) for any dtype string it
// doesn't recognize. Confirmed by inspecting the downloaded file
// (node_modules/@huggingface/transformers/.cache/.../vision_model.onnx
// vs vision_model_quantized.onnx) during Phase 15-2's implementation --
// this exact mistake is why Phase 15-1's PoC numbers needed correcting
// (see docs/IMAGE_EMBEDDING_POC.md's erratum).
export class TransformersImageEmbeddingProvider implements ImageEmbeddingProvider {
  readonly name = "xenova-siglip-base-patch16-224-onnx-q8";

  private static sessionPromise:
    | Promise<{
        processor: (image: unknown) => Promise<unknown>;
        model: (inputs: unknown) => Promise<{ pooler_output: { data: ArrayLike<number> } }>;
      }>
    | undefined;

  private static getSession() {
    if (!this.sessionPromise) {
      this.sessionPromise = import("@huggingface/transformers").then(
        async ({ env, AutoProcessor, SiglipVisionModel }) => {
          env.allowRemoteModels = false;
          env.localModelPath = path.join(process.cwd(), "models");
          const modelId = "Xenova/siglip-base-patch16-224";
          const [processor, model] = await Promise.all([
            AutoProcessor.from_pretrained(modelId, { local_files_only: true }),
            SiglipVisionModel.from_pretrained(modelId, { dtype: "q8", local_files_only: true }),
          ]);
          return {
            processor: (image: unknown) => processor(image),
            model: (inputs: unknown) => model(inputs),
          };
        },
      );
    }
    return this.sessionPromise;
  }

  // `imageUrl` is the post's own public Supabase Storage URL (or, in
  // principle, any readable image URL/local path) -- transformers.js's
  // RawImage.read() fetches it directly (this is an ordinary image-bytes
  // fetch, unrelated to the "never fetch the model itself over the
  // network" rule above; the model files are already local, the *photo*
  // was never going to be). A non-existent URL, a non-image response, or
  // a corrupt file all surface as a plain rejected promise here -- the
  // caller (embedPostImageBestEffort) is what decides that's a best-effort
  // failure, not this class's concern.
  async embed(imageUrl: string): Promise<number[]> {
    const { processor, model } = await TransformersImageEmbeddingProvider.getSession();
    const { RawImage } = await import("@huggingface/transformers");
    const image = await RawImage.read(imageUrl);
    const inputs = await processor(image);
    const { pooler_output } = await model(inputs);
    return normalize(Array.from(pooler_output.data));
  }
}

let defaultProvider: ImageEmbeddingProvider | undefined;

export function getImageEmbeddingProvider(): ImageEmbeddingProvider {
  if (!defaultProvider) defaultProvider = new TransformersImageEmbeddingProvider();
  return defaultProvider;
}
