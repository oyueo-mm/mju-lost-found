-- Phase 11-5: "서비스 개선 제안" -- one new table plus two new enums, no
-- change to any existing table/column. Deliberately separate from Report
-- (which targets a specific post/message/comment/user) -- Feedback has no
-- target at all, see the model's own comment in schema.prisma. Hand-written,
-- same convention as every migration since Phase 23.

-- CreateEnum
CREATE TYPE "FeedbackCategory" AS ENUM ('feature_request', 'inconvenience', 'bug', 'other');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('received', 'in_review', 'planned', 'completed', 'not_planned');

-- CreateTable
CREATE TABLE "Feedback" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "category" "FeedbackCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'received',
    "admin_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_feedback_user_id" ON "Feedback"("user_id");

-- CreateIndex
CREATE INDEX "idx_feedback_status" ON "Feedback"("status");

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
