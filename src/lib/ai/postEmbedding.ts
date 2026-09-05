import { buildEmbeddingText, getEmbeddingProvider, type EmbeddableFields } from "./embedding";
import { getImageEmbeddingProvider } from "./imageEmbedding";
import { saveEmbedding, saveImageEmbedding } from "./vectorSearch";
import type { PostType } from "@/lib/posts/schema";

// The four fields whose change should trigger re-embedding a post -- see
// src/lib/posts/service.ts's createLostPost/updateLostPost etc.
// (buildEmbeddingText only ever reads these four anyway, but this list is
// what those callers check against the *input* they received, before any
// embedding work happens, to decide whether re-embedding is needed at all).
export const EMBEDDING_INPUT_FIELDS = ["title", "description", "category", "location"] as const;

// Best-effort: embedding generation is a distinct step *after* the post
// row itself has already been created/updated (called post-commit by
// posts/service.ts), and never blocks or fails that mutation --
// see docs/AI_MATCHING_ARCHITECTURE.md's "Option B" discussion (consistency
// vs. UX vs. serverless retry-ability) for why. A post whose embedding
// generation fails here still exists and is fully usable; it just doesn't
// show up in AI match candidates yet (src/lib/match/candidates.ts's
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

// Phase 15-2: image counterpart of embedPostBestEffort() above -- same
// "post-commit, best-effort, never blocks or fails the mutation it
// follows" policy. Only ever called from src/lib/images/service.ts
// (setPostImage), right after that post's imageUrl has already been
// written -- a post whose image-embedding generation fails here still has
// its new image and is fully usable; it simply doesn't show up in "이 사진과
// 비슷한 게시물" until a future successful image replace regenerates it (no
// backfill script exists for images yet, matching this phase's scope --
// see docs/IMAGE_EMBEDDING_POC.md). The failure itself is logged
// server-side (for operators to notice a systemic problem, e.g. the model
// files missing) but never surfaced to the client -- setPostImage's
// return value doesn't carry it at all, so no stack trace or internal
// error detail can leak into the HTTP response.
export async function embedPostImageBestEffort(
  type: PostType,
  id: number,
  imageUrl: string,
): Promise<void> {
  try {
    const vector = await getImageEmbeddingProvider().embed(imageUrl);
    await saveImageEmbedding(type, id, vector);
  } catch (error) {
    console.error(`Failed to generate image embedding for ${type} post ${id}:`, error);
  }
}
