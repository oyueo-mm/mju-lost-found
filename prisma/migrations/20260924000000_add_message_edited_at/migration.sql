-- Phase P-6: lets a message show it was edited ("수정됨") -- purely
-- additive, nullable, no default. Every existing message gets NULL
-- ("never edited"). Message deletion itself needs no schema change at
-- all -- it reuses the existing hidden_at/hidden_by_user_id/hidden_reason
-- columns already added for admin moderation (see schema.prisma's own
-- comment on Message.hiddenAt).
--
-- Hand-written (not `prisma migrate diff`), same reason as every migration
-- since Phase 23 -- see e.g. 20260915000000_add_user_suspended_by.

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "edited_at" TIMESTAMP(3);
