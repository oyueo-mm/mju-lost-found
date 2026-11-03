-- 감사 쪽지 (ThankNote): additive only, one transaction. A new table; no
-- stored row is changed. Rolling back = DROP TABLE "ThankNote" (nothing else
-- references it).
BEGIN;

CREATE TABLE "ThankNote" (
    "id" SERIAL NOT NULL,
    "post_type" TEXT NOT NULL,
    "post_id" INTEGER NOT NULL,
    "chat_room_id" INTEGER,
    "sender_user_id" INTEGER NOT NULL,
    "receiver_user_id" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "published_at" TIMESTAMP(3),
    "hidden_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThankNote_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ThankNote_post_type_check" CHECK ("post_type" IN ('lost', 'found')),
    CONSTRAINT "ThankNote_not_self_check" CHECK ("sender_user_id" <> "receiver_user_id"),
    CONSTRAINT "ThankNote_body_check" CHECK (char_length("body") BETWEEN 1 AND 500)
);

CREATE UNIQUE INDEX "uq_thanknote_post_sender" ON "ThankNote"("post_type", "post_id", "sender_user_id");
CREATE INDEX "idx_thanknote_receiver" ON "ThankNote"("receiver_user_id", "created_at");
CREATE INDEX "idx_thanknote_sender" ON "ThankNote"("sender_user_id", "created_at");

ALTER TABLE "ThankNote" ADD CONSTRAINT "ThankNote_chat_room_id_fkey" FOREIGN KEY ("chat_room_id") REFERENCES "ChatRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ThankNote" ADD CONSTRAINT "ThankNote_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ThankNote" ADD CONSTRAINT "ThankNote_receiver_user_id_fkey" FOREIGN KEY ("receiver_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
