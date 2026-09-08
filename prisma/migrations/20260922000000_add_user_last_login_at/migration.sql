-- Phase P-1: records the last time a user actually completed a Google
-- sign-in (see schema.prisma's own comment on User.lastLoginAt) -- distinct
-- from created_at (account creation, once). Purely additive, nullable, no
-- default: every existing row gets NULL ("last login unknown, predates this
-- column") rather than a fabricated timestamp.
--
-- Hand-written (not `prisma migrate diff`), same reason as every migration
-- since Phase 23 -- see e.g. 20260915000000_add_user_suspended_by.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "last_login_at" TIMESTAMP(3);
