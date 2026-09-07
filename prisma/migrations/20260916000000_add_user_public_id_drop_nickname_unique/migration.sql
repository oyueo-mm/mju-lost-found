-- Phase H-7: adds User.public_id, an opaque unguessable identifier for
-- public profile URLs (/profile/[publicId]), and drops the old UNIQUE
-- constraint on nickname (duplicate nicknames are now allowed by design --
-- public identity uses public_id instead).
--
-- Hand-written (not `prisma migrate diff`), same reason as every migration
-- since Phase 23: the live database has columns/indexes from earlier,
-- never-committed work that isn't part of prisma/schema.prisma in this
-- branch.
--
-- gen_random_uuid() is a volatile default, so Postgres computes it once per
-- existing row when the column is added -- every current user gets their
-- own distinct public_id in this same statement, not a shared/duplicate
-- value. No pgcrypto extension needed: gen_random_uuid() has been a
-- built-in Postgres function since v13 (this project targets Supabase,
-- which is well past that).

-- AlterTable
ALTER TABLE "User" ADD COLUMN "public_id" UUID NOT NULL DEFAULT gen_random_uuid();

-- CreateIndex
CREATE UNIQUE INDEX "User_public_id_key" ON "User"("public_id");

-- DropIndex
DROP INDEX "User_nickname_key";
