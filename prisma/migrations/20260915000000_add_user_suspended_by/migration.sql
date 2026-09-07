-- Phase H-3: records which admin most recently suspended a user directly
-- (via /admin/users), mirroring isSuspended/suspendedUntil's own
-- "current state only" shape -- see schema.prisma's own comment on
-- User.suspendedByUserId. Purely additive, nullable, no default data
-- migration: every existing row (including already-suspended users) gets
-- NULL, which is correct -- there is no way to recover who suspended them
-- in the past, so this is left unknown rather than guessed.
--
-- Hand-written (not `prisma migrate diff`), same reason as every migration
-- since Phase 23: the live database has columns/indexes from earlier,
-- never-committed work that isn't part of prisma/schema.prisma in this
-- branch. This migration only adds the one new column and its FK.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "suspended_by_user_id" INTEGER;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_suspended_by_user_id_fkey" FOREIGN KEY ("suspended_by_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
