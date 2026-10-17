-- 관리자 활동 > 방문: one row per admin visit (signed-in use without a
-- 30-minute gap), start and last activity times only (see schema.prisma
-- AdminVisit). Additive only; no backfill -- earlier visits were never
-- recorded and are shown as 미측정.
BEGIN;

CREATE TABLE "AdminVisit" (
    "id" SERIAL NOT NULL,
    "admin_user_id" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "last_active_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminVisit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_adminvisit_admin_started" ON "AdminVisit"("admin_user_id", "started_at");
CREATE INDEX "idx_adminvisit_started" ON "AdminVisit"("started_at");

ALTER TABLE "AdminVisit" ADD CONSTRAINT "AdminVisit_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
