-- Phase 10: account withdrawal. Purely additive, nullable, no default --
-- every existing row starts out active (NULL), same as every account
-- created before this phase. The User row itself is never deleted by
-- this feature (see auth/user.ts's withdrawUser for why) -- there is no
-- corresponding DELETE anywhere in this migration.
--
-- Hand-written (not `prisma migrate diff`), same reason as every
-- migration since Phase 23 -- see e.g. 20260925000000_add_user_privacy_consent_at.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "deleted_at" TIMESTAMP(3);
