-- Phase P-5: lets a poster who genuinely doesn't know the exact time or
-- location mark it as unknown (NULL) instead of being forced to guess or
-- type a meaningless "미상" placeholder string. Purely a constraint drop
-- (DROP NOT NULL) -- no column type change, no default, no data rewrite.
-- Every existing row already has a real, non-null value in each of these
-- four columns, so nothing about existing data changes; only new/edited
-- rows can now store NULL here.
--
-- Hand-written (not `prisma migrate diff`), same reason as every migration
-- since Phase 23 -- see e.g. 20260915000000_add_user_suspended_by.

-- AlterTable
ALTER TABLE "LostPost" ALTER COLUMN "location" DROP NOT NULL;
ALTER TABLE "LostPost" ALTER COLUMN "lost_at" DROP NOT NULL;

-- AlterTable
ALTER TABLE "FoundPost" ALTER COLUMN "location" DROP NOT NULL;
ALTER TABLE "FoundPost" ALTER COLUMN "found_at" DROP NOT NULL;
