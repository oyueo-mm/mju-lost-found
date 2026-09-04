import { z } from "zod";

// Reuses the exact pagination convention already established for posts
// (Phase 3/6) rather than inventing a second one.
import { DEFAULT_LIMIT, DEFAULT_PAGE, MAX_LIMIT } from "@/lib/posts/schema";

export { DEFAULT_LIMIT, DEFAULT_PAGE, MAX_LIMIT };

export const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(DEFAULT_PAGE),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .catch(DEFAULT_LIMIT)
    .transform((n) => Math.min(n, MAX_LIMIT)),
});
