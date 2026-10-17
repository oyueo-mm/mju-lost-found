-- 관리자 활동: completed admin tasks that no other table records with their
-- admin and time (see schema.prisma AdminActivityLog). Additive only; no
-- backfill -- earlier tasks of these kinds were never recorded and are
-- shown as 미측정.
BEGIN;

CREATE TABLE "AdminActivityLog" (
    "id" SERIAL NOT NULL,
    "admin_user_id" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminActivityLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_adminactivitylog_admin_created" ON "AdminActivityLog"("admin_user_id", "created_at");
CREATE INDEX "idx_adminactivitylog_created" ON "AdminActivityLog"("created_at");

ALTER TABLE "AdminActivityLog" ADD CONSTRAINT "AdminActivityLog_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
