-- Phase 12-5: optional organization attribution on LostPost/FoundPost/
-- Comment -- 3 new nullable columns + FKs, no change to any existing
-- column. SetNull (not Cascade/Restrict) so that if an Organization row
-- is ever actually deleted in the future, existing posts/comments survive
-- as ordinary personal ones rather than being blocked or cascaded away --
-- Organization itself is still never hard-deleted today (only
-- ACTIVE/INACTIVE), so this FK behavior currently never fires in
-- practice. Hand-written, same convention as every migration since Phase 23.

-- AlterTable
ALTER TABLE "LostPost" ADD COLUMN "organization_id" INTEGER;

-- AlterTable
ALTER TABLE "FoundPost" ADD COLUMN "organization_id" INTEGER;

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN "organization_id" INTEGER;

-- CreateIndex
CREATE INDEX "idx_lostpost_organization_id" ON "LostPost"("organization_id");

-- CreateIndex
CREATE INDEX "idx_foundpost_organization_id" ON "FoundPost"("organization_id");

-- CreateIndex
CREATE INDEX "idx_comment_organization_id" ON "Comment"("organization_id");

-- AddForeignKey
ALTER TABLE "LostPost" ADD CONSTRAINT "LostPost_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoundPost" ADD CONSTRAINT "FoundPost_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
