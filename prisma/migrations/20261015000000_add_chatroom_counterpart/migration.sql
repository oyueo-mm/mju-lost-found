-- Phase 12-9 §3/§4: ChatRoom.counterpartUserId -- previously the room's
-- other party was only ever *computed* as "the post's current author",
-- which cannot represent "chat with a specific comment author" (a
-- different person in general). Backfilled from each existing row's own
-- post author (the only value it could have meant, since every existing
-- direct room predates this feature) before being made NOT NULL, so no
-- existing chat history is lost or reinterpreted. Hand-written, same
-- convention as every migration since Phase 23.

-- AlterTable: add the column nullable first (existing rows have no value yet)
ALTER TABLE "ChatRoom" ADD COLUMN "counterpart_user_id" INTEGER;

-- Backfill: every existing direct room's counterpart is its post's current
-- author -- exactly what resolveDetailDTO() used to compute on the fly.
-- ON DELETE CASCADE on direct_lost_post_id/direct_found_post_id guarantees
-- every existing ChatRoom row's post still exists (a deleted post cascades
-- its rooms away too), so this backfill is total: no row is left NULL.
UPDATE "ChatRoom" AS cr
SET "counterpart_user_id" = lp."user_id"
FROM "LostPost" AS lp
WHERE cr."direct_lost_post_id" = lp."id";

UPDATE "ChatRoom" AS cr
SET "counterpart_user_id" = fp."user_id"
FROM "FoundPost" AS fp
WHERE cr."direct_found_post_id" = fp."id";

-- Now safe to enforce NOT NULL -- every future INSERT always supplies it
-- explicitly (see chat/service.ts's getOrCreateDirectChatRoom).
ALTER TABLE "ChatRoom" ALTER COLUMN "counterpart_user_id" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "ChatRoom" ADD CONSTRAINT "ChatRoom_counterpart_user_id_fkey" FOREIGN KEY ("counterpart_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Replace the old (post, initiator) unique constraints with (post,
-- initiator, counterpart) -- a viewer can now hold one room with the
-- post's author and a separate room per distinct comment author on that
-- same post, without either colliding.
DROP INDEX "idx_chatroom_direct_lost_unique";
DROP INDEX "idx_chatroom_direct_found_unique";

CREATE UNIQUE INDEX "idx_chatroom_direct_lost_unique" ON "ChatRoom"("direct_lost_post_id", "initiator_user_id", "counterpart_user_id");
CREATE UNIQUE INDEX "idx_chatroom_direct_found_unique" ON "ChatRoom"("direct_found_post_id", "initiator_user_id", "counterpart_user_id");

-- CreateIndex
CREATE INDEX "idx_chatroom_counterpart_user_id" ON "ChatRoom"("counterpart_user_id");
