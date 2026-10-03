-- Deleting a comment that already has replies used to hard-delete it, and
-- Comment.parent_id's ON DELETE CASCADE then deleted every reply -- other
-- users' content -- along with it. Such a comment is now kept as a
-- tombstone instead: its content is cleared and deleted_at is set, and
-- the replies stay. A comment without replies is still hard-deleted.
ALTER TABLE "Comment" ADD COLUMN "deleted_at" TIMESTAMP(3);
