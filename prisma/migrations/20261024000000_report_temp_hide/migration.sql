-- Temporary hide (임시 숨김) of posts/comments on rights-infringement
-- reports, recorded through the existing ModerationAction table, and the
-- author notifications for it.
ALTER TYPE "ModerationActionType" ADD VALUE IF NOT EXISTS 'temp_hide_post';
ALTER TYPE "ModerationActionType" ADD VALUE IF NOT EXISTS 'temp_hide_comment';
ALTER TYPE "ModerationActionType" ADD VALUE IF NOT EXISTS 'restore_post';
ALTER TYPE "ModerationActionType" ADD VALUE IF NOT EXISTS 'restore_comment';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'content_temp_hidden';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'content_restored';

ALTER TABLE "LostPost" ADD COLUMN "temp_hidden_at" TIMESTAMP(3);
ALTER TABLE "FoundPost" ADD COLUMN "temp_hidden_at" TIMESTAMP(3);
ALTER TABLE "Comment" ADD COLUMN "temp_hidden_at" TIMESTAMP(3);
