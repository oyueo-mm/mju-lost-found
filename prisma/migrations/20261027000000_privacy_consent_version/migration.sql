-- 개인정보 동의 버전. Deliberately not backfilled: every existing account
-- (NULL) must agree to the current privacy notice again on the consent
-- screen (session.ts::hasRequiredConsents).
ALTER TABLE "User" ADD COLUMN "privacy_consent_version" TEXT;
