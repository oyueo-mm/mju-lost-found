-- Phase D-3: message reply -- adds one nullable self-referencing column +
-- index + FK on Message. No new table.
--
-- Hand-written (not `prisma migrate diff`'s raw output), same reason as
-- every migration since Phase 23 -- see 20260910000000_add_post_campus's
-- own comment: the live database carries pre-existing objects (pgvector
-- extension schema, Phase 15-5 columns) not reflected in this branch's
-- schema.prisma, so a blind diff-to-schema migration would be destructive.
-- This migration is purely additive and touches nothing else.

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "reply_to_message_id" INTEGER;

-- CreateIndex
CREATE INDEX "idx_message_reply_to" ON "Message"("reply_to_message_id");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_reply_to_message_id_fkey" FOREIGN KEY ("reply_to_message_id") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
