-- Phase 8: records when a user agreed to the service's privacy notice.
-- Purely additive, nullable, no default -- every existing row (this
-- migration never backfills one) starts out exactly like a brand-new
-- user: not yet consented, same as every account created before this
-- phase. Not a boolean: the timestamp itself is the point (see
-- schema.prisma's own comment on User.privacyConsentAt).
--
-- Hand-written (not `prisma migrate diff`), same reason as every
-- migration since Phase 23 -- see e.g. 20260924000000_add_message_edited_at.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "privacy_consent_at" TIMESTAMP(3);
