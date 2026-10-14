-- 실명·소속 자동 수집: the (optional) consent is recorded on the account,
-- apart from the values, so it can be given before they are available.
-- Additive; existing rows get NULL (no consent on file).
BEGIN;

ALTER TABLE "User" ADD COLUMN "identity_consent_version" TEXT;
ALTER TABLE "User" ADD COLUMN "identity_consent_at" TIMESTAMP(3);

COMMIT;
