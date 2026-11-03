-- 채팅방 찾음 완료(반환 연결), 감사 쪽지 신고·수신 알림, 채팅 웹 푸시.
-- Additive only, one transaction: new tables, two nullable ThankNote columns
-- and three enum values. No stored row is changed. The previous release's
-- code never reads any of it, so it can run before the new code is live.
BEGIN;

ALTER TYPE "ReportTargetType" ADD VALUE IF NOT EXISTS 'thank_note';
ALTER TYPE "ModerationActionType" ADD VALUE IF NOT EXISTS 'hide_thank_note';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'thank_note';

CREATE TABLE "PostReturn" (
    "id" SERIAL NOT NULL,
    "post_type" TEXT NOT NULL,
    "post_id" INTEGER NOT NULL,
    "chat_room_id" INTEGER,
    "completed_by_user_id" INTEGER NOT NULL,
    "owner_user_id" INTEGER NOT NULL,
    "finder_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    CONSTRAINT "PostReturn_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PostReturn_post_type_check" CHECK ("post_type" IN ('lost', 'found')),
    CONSTRAINT "PostReturn_two_people_check" CHECK ("owner_user_id" <> "finder_user_id")
);
CREATE INDEX "idx_postreturn_post" ON "PostReturn"("post_type", "post_id");
-- at most one active return per post
CREATE UNIQUE INDEX "uq_postreturn_active" ON "PostReturn"("post_type", "post_id") WHERE "revoked_at" IS NULL;
ALTER TABLE "PostReturn" ADD CONSTRAINT "PostReturn_chat_room_id_fkey" FOREIGN KEY ("chat_room_id") REFERENCES "ChatRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PostReturn" ADD CONSTRAINT "PostReturn_completed_by_user_id_fkey" FOREIGN KEY ("completed_by_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PostReturn" ADD CONSTRAINT "PostReturn_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PostReturn" ADD CONSTRAINT "PostReturn_finder_user_id_fkey" FOREIGN KEY ("finder_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ThankNote" ADD COLUMN "return_id" INTEGER;
ALTER TABLE "ThankNote" ADD COLUMN "admin_hidden_at" TIMESTAMP(3);
ALTER TABLE "ThankNote" ADD CONSTRAINT "ThankNote_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "PostReturn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PushSubscription" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "device_label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_success_at" TIMESTAMP(3),
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "idx_pushsubscription_user" ON "PushSubscription"("user_id");
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PushOutbox" (
    "id" SERIAL NOT NULL,
    "message_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMP(3),
    "skipped" TEXT,
    "last_error" TEXT,
    CONSTRAINT "PushOutbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PushOutbox_message_id_key" ON "PushOutbox"("message_id");
CREATE INDEX "idx_pushoutbox_pending" ON "PushOutbox"("sent_at", "created_at");
ALTER TABLE "PushOutbox" ADD CONSTRAINT "PushOutbox_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ChatPresence" (
    "user_id" INTEGER NOT NULL,
    "chat_room_id" INTEGER NOT NULL,
    "seen_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChatPresence_pkey" PRIMARY KEY ("user_id", "chat_room_id")
);
ALTER TABLE "ChatPresence" ADD CONSTRAINT "ChatPresence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatPresence" ADD CONSTRAINT "ChatPresence_chat_room_id_fkey" FOREIGN KEY ("chat_room_id") REFERENCES "ChatRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
