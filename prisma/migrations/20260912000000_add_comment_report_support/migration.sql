-- Phase C-3: comment reports, reusing the existing Report/ModerationAction
-- system as-is -- no new tables, no new columns. Purely additive: one new
-- ReportTargetType value ("comment") so a Report row can point at a
-- Comment, and one new ModerationActionType value ("delete_comment") for
-- the one action a comment-targeted report can apply (see
-- moderation/service.ts's applyReportAction()).
--
-- Hand-written (not `prisma migrate diff`'s raw output), same reason as
-- every migration since Phase 23 -- see 20260910000000_add_post_campus's
-- own comment.

-- AlterEnum
ALTER TYPE "ReportTargetType" ADD VALUE 'comment';

-- AlterEnum
ALTER TYPE "ModerationActionType" ADD VALUE 'delete_comment';
