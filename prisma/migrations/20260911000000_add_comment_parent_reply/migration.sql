-- Phase C-2: one level of comment replies (Comment.parentId self-FK) plus
-- a COMMENT_REPLY notification type.
--
-- Hand-written (not `prisma migrate diff`'s raw output), same reason as
-- every migration since Phase 23 -- see 20260910000000_add_post_campus's
-- own comment: the live database carries pre-existing objects (pgvector
-- extension schema, Phase 15-5 columns) not reflected in this branch's
-- schema.prisma, so a blind diff-to-schema migration would be destructive.
-- This migration is purely additive: one new enum value on
-- NotificationType, and one nullable self-referencing column + index + FK
-- on Comment. It does not touch anything else.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'comment_reply';

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN "parent_id" INTEGER;

-- CreateIndex
CREATE INDEX "idx_comment_parent" ON "Comment"("parent_id");

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
