-- 이용약관 동의 Phase: two additive, nullable columns on "User" -- mirrors
-- privacy_consent_at's own shape exactly (same phase's migration that
-- added that column never backfilled existing rows either; see
-- schema.prisma's comment on termsAcceptedAt for why). No other table
-- touched, no data changed.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "terms_accepted_at" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "terms_version" TEXT;
