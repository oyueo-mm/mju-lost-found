-- Keep 1:1 chats alive when the post they started from is deleted.
--
-- Before: ChatRoom.direct_{lost,found}_post_id were ON DELETE CASCADE, so
-- deleting a post also deleted every chat room (and, via Message's own
-- cascade, every message from both participants) that started from it.
--
-- After: the post FK is ON DELETE SET NULL, and the room keeps a minimal
-- snapshot of the post -- only its type and title, never its body, place,
-- date or images -- so the room can still say which post it was about.
-- "Deleted post" is derived: both post FKs NULL.

ALTER TABLE "ChatRoom" ADD COLUMN "post_type" TEXT;
ALTER TABLE "ChatRoom" ADD COLUMN "post_title" TEXT;

UPDATE "ChatRoom" c
SET "post_type" = 'lost', "post_title" = l."title"
FROM "LostPost" l
WHERE c."direct_lost_post_id" = l."id";

UPDATE "ChatRoom" c
SET "post_type" = 'found', "post_title" = f."title"
FROM "FoundPost" f
WHERE c."direct_found_post_id" = f."id";

-- Every existing room has exactly one post FK set (the old CASCADE made a
-- post-less room impossible), so both columns are filled for every row.
ALTER TABLE "ChatRoom" ALTER COLUMN "post_type" SET NOT NULL;
ALTER TABLE "ChatRoom" ALTER COLUMN "post_title" SET NOT NULL;
ALTER TABLE "ChatRoom" ADD CONSTRAINT "chatroom_post_type_check" CHECK ("post_type" IN ('lost', 'found'));

ALTER TABLE "ChatRoom" DROP CONSTRAINT "ChatRoom_direct_lost_post_id_fkey";
ALTER TABLE "ChatRoom" ADD CONSTRAINT "ChatRoom_direct_lost_post_id_fkey" FOREIGN KEY ("direct_lost_post_id") REFERENCES "LostPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ChatRoom" DROP CONSTRAINT "ChatRoom_direct_found_post_id_fkey";
ALTER TABLE "ChatRoom" ADD CONSTRAINT "ChatRoom_direct_found_post_id_fkey" FOREIGN KEY ("direct_found_post_id") REFERENCES "FoundPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
