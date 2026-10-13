-- 카테고리 개선: phones, earphones and watches become their own categories.
-- Existing posts keep the same item, just under the new code: a former
-- electronics.phone / electronics.earphones / accessory.watch becomes
-- <new category>.other (the brand or watch kind isn't known). The legacy
-- `category` column is untouched (phone/earphones still map to 전자기기,
-- watch to 액세서리), so embeddings built from it don't change.
UPDATE "LostPost"  SET "category_code" = 'phone',     "subcategory" = 'phone.other'     WHERE "subcategory" = 'electronics.phone';
UPDATE "FoundPost" SET "category_code" = 'phone',     "subcategory" = 'phone.other'     WHERE "subcategory" = 'electronics.phone';
UPDATE "LostPost"  SET "category_code" = 'earphones', "subcategory" = 'earphones.other' WHERE "subcategory" = 'electronics.earphones';
UPDATE "FoundPost" SET "category_code" = 'earphones', "subcategory" = 'earphones.other' WHERE "subcategory" = 'electronics.earphones';
UPDATE "LostPost"  SET "category_code" = 'watch',     "subcategory" = 'watch.other'     WHERE "subcategory" = 'accessory.watch';
UPDATE "FoundPost" SET "category_code" = 'watch',     "subcategory" = 'watch.other'     WHERE "subcategory" = 'accessory.watch';

-- Admin category-review records refer to the same codes.
UPDATE "PostCategoryReview" SET "suggested_category_code" = 'phone',     "suggested_subcategory" = 'phone.other'     WHERE "suggested_subcategory" = 'electronics.phone';
UPDATE "PostCategoryReview" SET "suggested_category_code" = 'earphones', "suggested_subcategory" = 'earphones.other' WHERE "suggested_subcategory" = 'electronics.earphones';
UPDATE "PostCategoryReview" SET "suggested_category_code" = 'watch',     "suggested_subcategory" = 'watch.other'     WHERE "suggested_subcategory" = 'accessory.watch';
UPDATE "PostCategoryReview" SET "resolved_category_code" = 'phone',     "resolved_subcategory" = 'phone.other'     WHERE "resolved_subcategory" = 'electronics.phone';
UPDATE "PostCategoryReview" SET "resolved_category_code" = 'earphones', "resolved_subcategory" = 'earphones.other' WHERE "resolved_subcategory" = 'electronics.earphones';
UPDATE "PostCategoryReview" SET "resolved_category_code" = 'watch',     "resolved_subcategory" = 'watch.other'     WHERE "resolved_subcategory" = 'accessory.watch';

-- 게시판 상태 변경 이력.
CREATE TABLE "PostStatusChange" (
    "id" SERIAL NOT NULL,
    "post_type" TEXT NOT NULL,
    "post_id" INTEGER NOT NULL,
    "from_status" TEXT NOT NULL,
    "to_status" TEXT NOT NULL,
    "changed_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostStatusChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_post_status_change_post" ON "PostStatusChange"("post_type", "post_id", "created_at");
ALTER TABLE "PostStatusChange" ADD CONSTRAINT "PostStatusChange_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
