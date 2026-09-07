import { z } from "zod";

import { postTypeSchema } from "@/lib/posts/schema";

// Mirrors moderation/schema.ts's list-query pagination shape (same
// defaults/caps) -- this is a second, independent admin list (users, not
// reports), so it gets its own small schema file rather than widening
// moderation/schema.ts's scope.
export const DEFAULT_ADMIN_USER_PAGE = 1;
export const DEFAULT_ADMIN_USER_LIMIT = 20;
export const MAX_ADMIN_USER_LIMIT = 50;

export const listUsersForAdminQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).catch(DEFAULT_ADMIN_USER_PAGE),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .catch(DEFAULT_ADMIN_USER_LIMIT)
    .transform((n) => Math.min(n, MAX_ADMIN_USER_LIMIT)),
});

// Four independent toggles on the same User row -- isAdmin (promote/
// demote) and isSuspended (suspend/unsuspend) -- rather than two separate
// endpoints, one PATCH body dispatches to whichever the admin clicked.
// suspendDurationDays only applies to "suspend" (mirrors
// moderation/schema.ts's processReportSchema suspend flow: omitted means
// permanent, same as apply_report_action(suspend_duration_days=None)).
export const ADMIN_USER_ACTIONS = ["promote", "demote", "suspend", "unsuspend"] as const;
export type AdminUserAction = (typeof ADMIN_USER_ACTIONS)[number];

export const updateUserByAdminSchema = z.object({
  action: z.enum(ADMIN_USER_ACTIONS),
  // Phase F-2: same 1~365 cap as moderation/schema.ts's processReportSchema
  // -- both suspend paths (report-flow and this direct admin toggle) share
  // the identical duration contract, so an admin can't pass an
  // effectively-unbounded duration through whichever path lacks a cap.
  suspendDurationDays: z.coerce.number().int().positive().max(365).optional(),
});
export type UpdateUserByAdminInput = z.infer<typeof updateUserByAdminSchema>;

// Phase 28-2: admin post list/search -- `type` is required (LostPost/
// FoundPost are separate tables with independent id sequences, same
// reason every other post-by-id route requires it, see
// posts/schema.ts::postTypeSchema's own callers). q/category/authorQuery
// are all optional, same "omit to not filter" convention
// listReportsForAdminQuerySchema already uses.
export const DEFAULT_ADMIN_POST_PAGE = 1;
export const DEFAULT_ADMIN_POST_LIMIT = 20;
export const MAX_ADMIN_POST_LIMIT = 50;

export const listPostsForAdminQuerySchema = z.object({
  type: postTypeSchema,
  q: z.string().trim().max(200).optional(),
  category: z.string().trim().max(100).optional(),
  authorQuery: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).catch(DEFAULT_ADMIN_POST_PAGE),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .catch(DEFAULT_ADMIN_POST_LIMIT)
    .transform((n) => Math.min(n, MAX_ADMIN_POST_LIMIT)),
});
