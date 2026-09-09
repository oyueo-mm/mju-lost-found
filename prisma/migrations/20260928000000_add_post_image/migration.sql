-- Phase 11-4B: adds PostImage (1 row per image, ordered within a post)
-- without touching LostPost.imageUrl/embedding/imageEmbedding or
-- FoundPost.imageUrl/embedding/imageEmbedding at all -- those columns
-- stay exactly as they are, still the source of truth for every existing
-- reader (PostCard, chat's PostRef select, notifications, search/
-- recommendation) until a later phase wires PostImage into the actual
-- upload/edit flow. This migration only adds a new table and copies each
-- post's existing single image into it as that post's primary image --
-- no existing column, row value, or Storage object is touched.
--
-- Hand-written (not `prisma migrate diff`), same reason as every
-- migration since Phase 23 -- see e.g. 20260927000000_add_moderation_action_chatroom_indexes.

-- CreateTable
CREATE TABLE "PostImage" (
    "id" SERIAL NOT NULL,
    "lost_post_id" INTEGER,
    "found_post_id" INTEGER,
    "image_url" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_postimage_lost_order" ON "PostImage"("lost_post_id", "display_order");

-- CreateIndex
CREATE INDEX "idx_postimage_found_order" ON "PostImage"("found_post_id", "display_order");

-- Phase 11-4B: "게시글마다 대표 이미지는 최대 하나" -- a partial unique index
-- per post-type FK, not a plain `@@unique` (which would only allow one
-- row total, not one row *per post*). NULLs never collide in a unique
-- index (standard SQL semantics), so a found-side row (lost_post_id NULL)
-- never competes with this index at all -- the found_post_id index below
-- covers that side separately.
CREATE UNIQUE INDEX "idx_postimage_lost_primary_unique" ON "PostImage"("lost_post_id") WHERE "is_primary" = true;

-- CreateIndex
CREATE UNIQUE INDEX "idx_postimage_found_primary_unique" ON "PostImage"("found_post_id") WHERE "is_primary" = true;

-- Phase 11-4B: "정확히 하나의 게시글에만 속해야 한다" -- same rule
-- Comment.lostPostId/foundPostId already follows, but enforced here as a
-- real DB CHECK constraint too (not just application code), since this
-- is a brand-new table with no existing rows/behavior to stay compatible
-- with -- unlike Comment, adding one here costs nothing and closes the
-- gap a future application-code bug could otherwise slip through.
ALTER TABLE "PostImage" ADD CONSTRAINT "postimage_exactly_one_post_check" CHECK (
    ("lost_post_id" IS NOT NULL AND "found_post_id" IS NULL) OR
    ("lost_post_id" IS NULL AND "found_post_id" IS NOT NULL)
);

-- AddForeignKey
ALTER TABLE "PostImage" ADD CONSTRAINT "PostImage_lost_post_id_fkey" FOREIGN KEY ("lost_post_id") REFERENCES "LostPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostImage" ADD CONSTRAINT "PostImage_found_post_id_fkey" FOREIGN KEY ("found_post_id") REFERENCES "FoundPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Phase 11-4B: existing-data migration -- every post that currently has
-- an imageUrl gets exactly one PostImage row copied from it
-- (displayOrder=0, isPrimary=true). The Storage object itself is not
-- moved/renamed/touched -- only the URL string is copied into the new
-- row. A post with no imageUrl gets no PostImage row (never fabricated).
-- createdAt is copied from the post's own created_at as the closest
-- available proxy for "since when this post has had this image" -- this
-- app has no finer-grained history of exactly when an image was
-- attached/replaced, so this is the honest, non-fabricated choice
-- (never CURRENT_TIMESTAMP, which would misrepresent it as "added today").
INSERT INTO "PostImage" ("lost_post_id", "image_url", "display_order", "is_primary", "created_at")
SELECT "id", "image_url", 0, true, "created_at"
FROM "LostPost"
WHERE "image_url" IS NOT NULL;

INSERT INTO "PostImage" ("found_post_id", "image_url", "display_order", "is_primary", "created_at")
SELECT "id", "image_url", 0, true, "created_at"
FROM "FoundPost"
WHERE "image_url" IS NOT NULL;
