-- Verified external accounts: admin-approved non-university Google
-- accounts, and a userType on every User.

CREATE TYPE "UserType" AS ENUM ('student', 'external_verified', 'external_test');
CREATE TYPE "ExternalAccessStatus" AS ENUM ('active', 'revoked');

ALTER TABLE "User" ADD COLUMN "user_type" "UserType" NOT NULL DEFAULT 'student';
-- Any existing non-university account could only have signed in through
-- the Google test mode setting.
UPDATE "User" SET "user_type" = 'external_test' WHERE lower("email") NOT LIKE '%@mju.ac.kr';

CREATE TABLE "ExternalAccessGrant" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "affiliation" TEXT NOT NULL,
    "campus" TEXT NOT NULL,
    "status" "ExternalAccessStatus" NOT NULL DEFAULT 'active',
    "created_by_user_id" INTEGER NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExternalAccessGrant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "externalaccessgrant_email_lowercase_check" CHECK ("email" = lower("email")),
    CONSTRAINT "externalaccessgrant_campus_check" CHECK ("campus" IN ('인문캠퍼스', '자연캠퍼스', '양쪽'))
);
CREATE UNIQUE INDEX "ExternalAccessGrant_email_key" ON "ExternalAccessGrant"("email");
ALTER TABLE "ExternalAccessGrant" ADD CONSTRAINT "ExternalAccessGrant_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalAccessGrant" ADD CONSTRAINT "ExternalAccessGrant_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
