-- 키워드 알림 Phase: 사용자별 "이 키워드가 새 글에 있으면 알려줘" 규칙
-- (KeywordAlert)과 그 규칙이 실제로 매치되어 알림을 만든 기록
-- (KeywordAlertMatch) -- 1개 새 NotificationType 값, 1개 새 enum, 2개 새
-- 테이블. 기존 테이블/컬럼은 전혀 건드리지 않는다. Hand-written, same
-- convention as every migration since Phase 23.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'keyword_alert_match';

-- CreateEnum
CREATE TYPE "KeywordAlertPostType" AS ENUM ('all', 'lost', 'found');

-- CreateTable
CREATE TABLE "KeywordAlert" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "keyword" TEXT NOT NULL,
    "post_type" "KeywordAlertPostType" NOT NULL DEFAULT 'all',
    "campuses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exclude_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeywordAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_keyword_alert_user_id" ON "KeywordAlert"("user_id");

-- CreateTable
CREATE TABLE "KeywordAlertMatch" (
    "id" SERIAL NOT NULL,
    "keyword_alert_id" INTEGER NOT NULL,
    "post_type" TEXT NOT NULL,
    "post_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeywordAlertMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: the actual backstop against a duplicate notification for
-- the same (user, keyword alert, post) combination -- see that model's
-- own schema.prisma comment.
CREATE UNIQUE INDEX "idx_keyword_alert_match_unique" ON "KeywordAlertMatch"("keyword_alert_id", "post_type", "post_id");

-- AddForeignKey
ALTER TABLE "KeywordAlert" ADD CONSTRAINT "KeywordAlert_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordAlertMatch" ADD CONSTRAINT "KeywordAlertMatch_keyword_alert_id_fkey" FOREIGN KEY ("keyword_alert_id") REFERENCES "KeywordAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
