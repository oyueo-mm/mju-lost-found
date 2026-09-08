-- Phase N: one new table for the chat read-cursor (this phase's own spec:
-- "메시지마다 별도의 read row를 만드는 방식은 사용하지 않는다... cursor
-- 방식으로 설계한다"). Message.readAt is untouched -- no ALTER on that
-- table at all, per "기존 ChatRoom/Message 구조를 최대한 유지". Hand-written,
-- same convention as every migration since Phase 23.

-- CreateTable
CREATE TABLE "ChatRead" (
    "id" SERIAL NOT NULL,
    "chat_room_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "last_read_message_id" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatRead_chat_room_id_user_id_key" ON "ChatRead"("chat_room_id", "user_id");

-- AddForeignKey
ALTER TABLE "ChatRead" ADD CONSTRAINT "ChatRead_chat_room_id_fkey" FOREIGN KEY ("chat_room_id") REFERENCES "ChatRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRead" ADD CONSTRAINT "ChatRead_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
