-- Security audit P-5: server-side cut-off for JWT sessions.
-- Additive and nullable: existing rows and the previous deployment are unaffected.
ALTER TABLE "User" ADD COLUMN "sessions_valid_after" TIMESTAMP(3);
