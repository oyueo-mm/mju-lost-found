import { z } from "zod";

import { postTypeSchema } from "@/lib/posts/schema";

// The legacy app's only match-creation entry point (ui/common.py's
// "내 물건 같아요" button) always has a `score` in hand -- computed by the
// AI candidate ranker (ai/matching.py's cosine_similarity). That ranker
// isn't implemented yet (out of scope for this phase), so a match created
// here is a manual, user-confirmed one; `score` is optional and defaults
// to 1.0 (full confidence -- a human directly identified the pairing) in
// the service layer, while still accepting an explicit value so a future
// AI-assisted flow can pass its own computed score through the same API
// without a schema change.
export const createMatchSchema = z.object({
  lostPostId: z.coerce.number().int().positive("lostPostId가 올바르지 않습니다."),
  foundPostId: z.coerce.number().int().positive("foundPostId가 올바르지 않습니다."),
  score: z.number().min(0).max(1).optional(),
});
export type CreateMatchInput = z.infer<typeof createMatchSchema>;

// GET /api/matches?postId=&type= -- both present together, or neither
// (meaning "matches for the current user").
export const matchQuerySchema = z
  .object({
    postId: z.coerce.number().int().positive().optional(),
    type: postTypeSchema.optional(),
  })
  .refine((v) => (v.postId === undefined) === (v.type === undefined), {
    message: "postId와 type은 함께 제공되어야 합니다.",
  });
export type MatchQuery = z.infer<typeof matchQuerySchema>;
