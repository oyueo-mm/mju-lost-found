-- Phase 23: view counts, comments, and a matching-candidate cache.
--
-- Hand-written (not `prisma migrate diff`'s raw output): the live database
-- already has an `imageEmbeddingDino` column + HNSW indexes on LostPost/
-- FoundPost from earlier, never-committed Phase 15-5 work that isn't part
-- of prisma/schema.prisma in this branch. A blind diff-to-schema migration
-- would DROP those columns/indexes -- this migration deliberately contains
-- only additive statements for what Phase 23 actually needs, and touches
-- nothing else.

-- AlterTable
ALTER TABLE "LostPost" ADD COLUMN "view_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "FoundPost" ADD COLUMN "view_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Comment" (
    "id" SERIAL NOT NULL,
    "lost_post_id" INTEGER,
    "found_post_id" INTEGER,
    "author_user_id" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostView" (
    "id" SERIAL NOT NULL,
    "post_type" TEXT NOT NULL,
    "post_id" INTEGER NOT NULL,
    "viewer_key" TEXT NOT NULL,
    "viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchCandidateCache" (
    "id" SERIAL NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_post_id" INTEGER NOT NULL,
    "candidates" JSONB NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchCandidateCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_comment_lost_post_created" ON "Comment"("lost_post_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_comment_found_post_created" ON "Comment"("found_post_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "PostView_post_type_post_id_viewer_key_key" ON "PostView"("post_type", "post_id", "viewer_key");

-- CreateIndex
CREATE UNIQUE INDEX "MatchCandidateCache_source_type_source_post_id_key" ON "MatchCandidateCache"("source_type", "source_post_id");

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_lost_post_id_fkey" FOREIGN KEY ("lost_post_id") REFERENCES "LostPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_found_post_id_fkey" FOREIGN KEY ("found_post_id") REFERENCES "FoundPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
