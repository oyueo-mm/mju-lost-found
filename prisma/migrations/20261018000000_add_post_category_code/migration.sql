-- 카테고리 대분류-소분류 전환 1단계: 스키마만 추가한다.
--
-- - LostPost/FoundPost에 nullable `category_code`/`subcategory`를 추가한다.
--   둘 다 src/lib/posts/categoryTaxonomy.ts의 안정적인 code를 저장한다
--   ("electronics", "electronics.earphones"). null은 미분류, "<대분류>.other"는
--   실제로 기타로 분류된 물건 -- 둘은 같은 의미가 아니다.
-- - 기존 `category` 컬럼은 호환용으로 그대로 둔다(값도 바꾸지 않는다). 폼,
--   검색, 키워드 알림, 임베딩은 계속 이 컬럼을 읽는다.
-- - 자동 추천값과 실제 저장값을 섞지 않도록, 추천/검수 기록은 별도 테이블
--   PostCategoryReview에 둔다. 게시글 컬럼에는 확정된 값만 들어간다.
--
-- 이 migration은 어떤 기존 행도 UPDATE하지 않는다. 백필(1:1로 안전한 대분류만
-- category_code에 채우고, 나머지는 검수 후보로 기록)은
-- scripts/categoryBackfill.ts가 따로 한다 -- 규칙 기반 추천기가 TypeScript에
-- 있어서 SQL로 옮기지 않았다.
--
-- Hand-written, same convention as every migration since Phase 23.

-- AlterTable
ALTER TABLE "LostPost" ADD COLUMN "category_code" TEXT,
ADD COLUMN "subcategory" TEXT;

-- AlterTable
ALTER TABLE "FoundPost" ADD COLUMN "category_code" TEXT,
ADD COLUMN "subcategory" TEXT;

-- 유효한 code 목록 자체는 DB CHECK로 고정하지 않는다(기존 `category`와 같은
-- "목록은 앱이 검증" 관례 -- 소분류가 추가될 때마다 migration이 필요해지지
-- 않도록). 대신 "소분류는 반드시 자기 부모 대분류 밑에 있다"는 구조 규칙만 DB가
-- 보장한다: subcategory가 있으면 category_code도 있어야 하고, subcategory는
-- "<category_code>." 로 시작해야 한다.
ALTER TABLE "LostPost" ADD CONSTRAINT "lostpost_subcategory_parent_check" CHECK (
    "subcategory" IS NULL OR (
        "category_code" IS NOT NULL AND
        left("subcategory", length("category_code") + 1) = "category_code" || '.'
    )
);

ALTER TABLE "FoundPost" ADD CONSTRAINT "foundpost_subcategory_parent_check" CHECK (
    "subcategory" IS NULL OR (
        "category_code" IS NOT NULL AND
        left("subcategory", length("category_code") + 1) = "category_code" || '.'
    )
);

-- CreateIndex
CREATE INDEX "idx_lostpost_category_code" ON "LostPost"("category_code", "subcategory");

-- CreateIndex
CREATE INDEX "idx_foundpost_category_code" ON "FoundPost"("category_code", "subcategory");

-- CreateTable
-- 게시글 하나당 한 행: 전환 시점의 기존 category 스냅숏, 추천기 결과(후보),
-- 검수 필요 사유, 검수 결과. `suggested_*`는 추천값일 뿐이고 게시글의
-- category_code/subcategory에는 검수(또는 1:1 자동 확정)를 거친 값만 쓴다.
CREATE TABLE "PostCategoryReview" (
    "id" SERIAL NOT NULL,
    "lost_post_id" INTEGER,
    "found_post_id" INTEGER,
    "legacy_category" TEXT NOT NULL,
    "suggested_category_code" TEXT,
    "suggested_subcategory" TEXT,
    -- 'title' | 'description' | NULL(추천 없음)
    "suggestion_source" TEXT,
    "suggester_version" TEXT NOT NULL,
    -- 'legacy_other' | 'category_conflict' | 'unknown_legacy' | NULL
    -- (NULL = 대분류는 1:1로 자동 확정됨, 소분류 후보만 남아 있음)
    "review_reason" TEXT,
    -- 'no_suggestion' | 'category_only' | 'description_only' 중 0개 이상
    "ambiguities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    -- 'pending' | 'accepted'(추천 채택) | 'overridden'(다른 값으로 확정) | 'dismissed'
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolved_category_code" TEXT,
    "resolved_subcategory" TEXT,
    "reviewed_by_user_id" INTEGER,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostCategoryReview_pkey" PRIMARY KEY ("id")
);

-- PostImage와 같은 "정확히 한 게시글에만 속한다" 규칙.
ALTER TABLE "PostCategoryReview" ADD CONSTRAINT "postcategoryreview_exactly_one_post_check" CHECK (
    ("lost_post_id" IS NOT NULL AND "found_post_id" IS NULL) OR
    ("lost_post_id" IS NULL AND "found_post_id" IS NOT NULL)
);

ALTER TABLE "PostCategoryReview" ADD CONSTRAINT "postcategoryreview_status_check" CHECK (
    "status" IN ('pending', 'accepted', 'overridden', 'dismissed')
);

-- 게시글당 검수 행은 하나 -- 백필 스크립트를 다시 돌려도 중복되지 않는다.
-- CreateIndex
CREATE UNIQUE INDEX "idx_postcategoryreview_lost_post_unique" ON "PostCategoryReview"("lost_post_id");

-- CreateIndex
CREATE UNIQUE INDEX "idx_postcategoryreview_found_post_unique" ON "PostCategoryReview"("found_post_id");

-- CreateIndex
CREATE INDEX "idx_postcategoryreview_status_reason" ON "PostCategoryReview"("status", "review_reason");

-- AddForeignKey
ALTER TABLE "PostCategoryReview" ADD CONSTRAINT "PostCategoryReview_lost_post_id_fkey" FOREIGN KEY ("lost_post_id") REFERENCES "LostPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostCategoryReview" ADD CONSTRAINT "PostCategoryReview_found_post_id_fkey" FOREIGN KEY ("found_post_id") REFERENCES "FoundPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostCategoryReview" ADD CONSTRAINT "PostCategoryReview_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
