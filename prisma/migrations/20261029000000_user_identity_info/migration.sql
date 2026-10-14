-- 실명·학과: a member's self-entered real name and department, and a log
-- of every admin view of them. Additive only -- no existing row or column
-- changes. Wrapped in one transaction so a failure leaves nothing behind.
BEGIN;

CREATE TABLE "UserIdentityInfo" (
    "user_id" INTEGER NOT NULL,
    "real_name" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "consent_version" TEXT NOT NULL,
    "consented_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserIdentityInfo_pkey" PRIMARY KEY ("user_id")
);
ALTER TABLE "UserIdentityInfo" ADD CONSTRAINT "UserIdentityInfo_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "IdentityAccessLog" (
    "id" SERIAL NOT NULL,
    "admin_user_id" INTEGER NOT NULL,
    "target_user_id" INTEGER NOT NULL,
    "report_id" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "accessed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IdentityAccessLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_identityaccesslog_admin_accessed" ON "IdentityAccessLog"("admin_user_id", "accessed_at");
CREATE INDEX "idx_identityaccesslog_target" ON "IdentityAccessLog"("target_user_id");
ALTER TABLE "IdentityAccessLog" ADD CONSTRAINT "IdentityAccessLog_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IdentityAccessLog" ADD CONSTRAINT "IdentityAccessLog_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "Report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
