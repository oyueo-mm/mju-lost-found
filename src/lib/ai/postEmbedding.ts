import { buildEmbeddingText, getEmbeddingProvider, type EmbeddableFields } from "./embedding";
import { saveEmbedding } from "./vectorSearch";
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
