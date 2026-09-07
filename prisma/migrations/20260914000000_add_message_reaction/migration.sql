-- Phase D-4: emoji reactions on chat messages -- one new table, no
-- changes to any existing table.
--
-- Hand-written (not `prisma migrate diff`'s raw output), same reason as
-- every migration since Phase 23 -- see 20260910000000_add_post_campus's
-- own comment: the live database carries pre-existing objects (pgvector
-- extension schema, Phase 15-5 columns) not reflected in this branch's
-- schema.prisma, so a blind diff-to-schema migration would be destructive.

-- CreateTable
CREATE TABLE "MessageReaction" (
    "id" SERIAL NOT NULL,
    "message_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_message_reaction_message_id" ON "MessageReaction"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "MessageReaction_message_id_user_id_emoji_key" ON "MessageReaction"("message_id", "user_id", "emoji");

-- AddForeignKey
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
