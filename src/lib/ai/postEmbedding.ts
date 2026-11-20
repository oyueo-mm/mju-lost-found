import { buildEmbeddingText, getEmbeddingProvider, type EmbeddableFields } from "./embedding";
import { saveEmbedding } from "./vectorSearch";
import type { PostType } from "@/lib/posts/schema";

// The four re-embedding fields now live in ./embeddingFields (no imports),
// re-exported here for existing callers.
export { EMBEDDING_INPUT_FIELDS } from "./embeddingFields";

// Best-effort: embedding generation is a distinct step *after* the post
// row itself has already been created/updated (called post-commit by
// posts/service.ts), and never blocks or fails that mutation --
// see docs/AI_MATCHING_ARCHITECTURE.md's "Option B" discussion (consistency
// vs. UX vs. serverless retry-ability) for why. A post whose embedding
// generation fails here still exists and is fully usable; it just doesn't
// show up in AI recommendations yet (src/lib/recommendation/service.ts's
// EmbeddingNotAvailableError path) until the next successful edit, or a
// backfill run, regenerates it.
export async function embedPostBestEffort(
  type: PostType,
  id: number,
  fields: EmbeddableFields,
): Promise<void> {
  try {
    const text = buildEmbeddingText(fields);
    const vector = await getEmbeddingProvider().embed(text);
    await saveEmbedding(type, id, vector);
  } catch (error) {
    console.error(`Failed to generate embedding for ${type} post ${id}:`, error);
  }
}

// Compatibility entry point for older operational tools. The DB's current
// image and durable job are authoritative; a caller's stale URL cannot start
// independent inference. Lazy import avoids a posts/recommendations cycle at
// module initialization. The text embedding path above stays unchanged.
export async function embedPostImageBestEffort(
  type: PostType,
  id: number,
  imageUrl: string,
): Promise<void> {
  void imageUrl; // retained for source compatibility with existing seed tools
  try {
    const { runImageJob } = await import("./imageJob");
    const result = await runImageJob(type, id);
    if (result.status === "failed") console.error("Image embedding job failed");
  } catch (error) {
    console.error("Image embedding job unavailable:", error instanceof Error ? error.name : "Error");
  }
}
