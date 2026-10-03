-- Chat images move to the private chat-images bucket. Message.image_url
-- now stores the object path (chat/{roomId}/{uuid}.{ext}) instead of a
-- public URL; no existing row has an image (checked on both Production
-- and Preview before this migration), so no data is rewritten.
--
-- One object must never back two messages: deleting one message's image
-- would otherwise break the other. NULLs (text-only messages) are
-- distinct in a Postgres unique index, so they are unaffected.
CREATE UNIQUE INDEX "Message_image_url_key" ON "Message"("image_url");
