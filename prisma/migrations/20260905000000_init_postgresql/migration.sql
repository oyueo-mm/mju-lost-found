-- Phase 3: initial PostgreSQL schema history.
--
-- No prior migration ever ran (the MySQL/MariaDB datasource from an earlier
-- phase was a placeholder, never connected to a live database -- see
-- prisma/schema.prisma's header comment), and there is no production data
-- to preserve. Rather than translate a MySQL migration that never actually
-- executed, this is a fresh initial migration generated directly from the
-- current (PostgreSQL) schema.prisma via:
--
--   npx prisma migrate diff --from-empty --to-schema=prisma/schema.prisma --script
--
-- which only reads the schema file and Prisma's own SQL-generation engine
-- -- it does not require a live database connection, so this was verified
-- offline (see the Phase 3 report for the full command output).

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "LostPostStatus" AS ENUM ('찾는 중', '찾음');

-- CreateEnum
CREATE TYPE "FoundPostStatus" AS ENUM ('보관 중', '완료');

-- CreateEnum
CREATE TYPE "ReportTargetType" AS ENUM ('post', 'message', 'user');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('pending', 'dismissed', 'actioned');

-- CreateEnum
CREATE TYPE "ModerationActionType" AS ENUM ('delete_post', 'hide_message', 'suspend_user');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('message', 'match', 'report_processed', 'post_deleted', 'message_hidden', 'user_suspended');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nickname" TEXT,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "is_suspended" BOOLEAN NOT NULL DEFAULT false,
    "suspended_until" TIMESTAMP(3),
    "google_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LostPost" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "lost_at" TIMESTAMP(3) NOT NULL,
    "status" "LostPostStatus" NOT NULL DEFAULT '찾는 중',
    "image_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LostPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoundPost" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "found_at" TIMESTAMP(3) NOT NULL,
    "status" "FoundPostStatus" NOT NULL DEFAULT '보관 중',
    "image_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FoundPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" SERIAL NOT NULL,
    "lost_post_id" INTEGER NOT NULL,
    "found_post_id" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatRoom" (
    "id" SERIAL NOT NULL,
    "match_id" INTEGER,
    "direct_lost_post_id" INTEGER,
    "direct_found_post_id" INTEGER,
    "initiator_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" SERIAL NOT NULL,
    "chat_room_id" INTEGER NOT NULL,
    "sender_user_id" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),
    "hidden_at" TIMESTAMP(3),
    "hidden_by_user_id" INTEGER,
    "hidden_reason" TEXT,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" SERIAL NOT NULL,
    "reporter_user_id" INTEGER NOT NULL,
    "target_type" "ReportTargetType" NOT NULL,
    "target_id" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ReportStatus" NOT NULL DEFAULT 'pending',
    "processed_at" TIMESTAMP(3),
    "processed_by_user_id" INTEGER,
    "admin_note" TEXT,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationAction" (
    "id" SERIAL NOT NULL,
    "report_id" INTEGER NOT NULL,
    "target_type" "ReportTargetType" NOT NULL,
    "target_id" INTEGER NOT NULL,
    "action_type" "ModerationActionType" NOT NULL,
    "reason" TEXT,
    "admin_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "ModerationAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "related_type" TEXT,
    "related_id" INTEGER,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_nickname_key" ON "User"("nickname");

-- CreateIndex
CREATE UNIQUE INDEX "User_google_id_key" ON "User"("google_id");

-- CreateIndex
CREATE INDEX "idx_lostpost_user_id" ON "LostPost"("user_id");

-- CreateIndex
CREATE INDEX "idx_foundpost_user_id" ON "FoundPost"("user_id");

-- CreateIndex
CREATE INDEX "idx_match_lost_post_id" ON "Match"("lost_post_id");

-- CreateIndex
CREATE INDEX "idx_match_found_post_id" ON "Match"("found_post_id");

-- CreateIndex
CREATE UNIQUE INDEX "Match_lost_post_id_found_post_id_key" ON "Match"("lost_post_id", "found_post_id");

-- CreateIndex
CREATE UNIQUE INDEX "ChatRoom_match_id_key" ON "ChatRoom"("match_id");

-- CreateIndex
CREATE UNIQUE INDEX "idx_chatroom_direct_lost_unique" ON "ChatRoom"("direct_lost_post_id", "initiator_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "idx_chatroom_direct_found_unique" ON "ChatRoom"("direct_found_post_id", "initiator_user_id");

-- CreateIndex
CREATE INDEX "idx_message_chat_room_id" ON "Message"("chat_room_id");

-- CreateIndex
CREATE INDEX "idx_message_chat_room_created_id" ON "Message"("chat_room_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "idx_report_reporter_user_id" ON "Report"("reporter_user_id");

-- CreateIndex
CREATE INDEX "idx_report_status" ON "Report"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Report_reporter_user_id_target_type_target_id_key" ON "Report"("reporter_user_id", "target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "ModerationAction_report_id_key" ON "ModerationAction"("report_id");

-- CreateIndex
CREATE INDEX "idx_notification_user_read_created" ON "Notification"("user_id", "is_read", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_user_id_type_related_type_related_id_key" ON "Notification"("user_id", "type", "related_type", "related_id");

-- AddForeignKey
ALTER TABLE "LostPost" ADD CONSTRAINT "LostPost_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoundPost" ADD CONSTRAINT "FoundPost_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_lost_post_id_fkey" FOREIGN KEY ("lost_post_id") REFERENCES "LostPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_found_post_id_fkey" FOREIGN KEY ("found_post_id") REFERENCES "FoundPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRoom" ADD CONSTRAINT "ChatRoom_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRoom" ADD CONSTRAINT "ChatRoom_direct_lost_post_id_fkey" FOREIGN KEY ("direct_lost_post_id") REFERENCES "LostPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRoom" ADD CONSTRAINT "ChatRoom_direct_found_post_id_fkey" FOREIGN KEY ("direct_found_post_id") REFERENCES "FoundPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRoom" ADD CONSTRAINT "ChatRoom_initiator_user_id_fkey" FOREIGN KEY ("initiator_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_chat_room_id_fkey" FOREIGN KEY ("chat_room_id") REFERENCES "ChatRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_hidden_by_user_id_fkey" FOREIGN KEY ("hidden_by_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_processed_by_user_id_fkey" FOREIGN KEY ("processed_by_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "Report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
