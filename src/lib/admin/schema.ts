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
  // Phase I: same "required specifically for action=suspend" shape as
  // moderation/schema.ts's processReportSchema -- kept optional at the
  // schema layer (this schema has no per-action branching), the real
  // requiredness check lives in updateUserByAdmin() itself.
  reasonCategory: z.string().trim().max(100).optional(),
  reason: z.string().trim().max(500).optional(),
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

// Phase 관리자 승인제: the same four toggles ADMIN_USER_ACTIONS above
// exposes, renamed to the *effect* on the target row (see
// AdminActionProposalType's own schema.prisma comment) -- this is the
// input shape for creating a proposal directly (the standalone /admin
// proposal-creation UI), separate from updateUserByAdminSchema above,
// which an admin still submits through the ordinary user-management
// screen and which admin/users.ts::updateUserByAdmin() itself converts
// into a proposal server-side when the target requires one.
export const ADMIN_ACTION_PROPOSAL_TYPES = ["suspend_user", "unsuspend_user", "grant_admin", "revoke_admin"] as const;
export type AdminActionProposalTypeValue = (typeof ADMIN_ACTION_PROPOSAL_TYPES)[number];

export const ADMIN_ACTION_PROPOSAL_TYPE_LABELS: Record<AdminActionProposalTypeValue, string> = {
  suspend_user: "정지·제재 부과",
  unsuspend_user: "정지·제재 해제",
  grant_admin: "관리자 권한 부여",
  revoke_admin: "관리자 권한 해제",
};

export const createAdminActionProposalSchema = z.object({
  targetUserId: z.coerce.number().int().positive(),
  actionType: z.enum(ADMIN_ACTION_PROPOSAL_TYPES),
  // Same "1~365, omit for permanent" contract as updateUserByAdminSchema's
  // own suspendDurationDays -- only meaningful for actionType=suspend_user.
  suspendDurationDays: z.coerce.number().int().positive().max(365).optional(),
  reasonCategory: z.string().trim().max(100).optional(),
  reason: z.string().trim().max(500).optional(),
});
export type CreateAdminActionProposalInput = z.infer<typeof createAdminActionProposalSchema>;
