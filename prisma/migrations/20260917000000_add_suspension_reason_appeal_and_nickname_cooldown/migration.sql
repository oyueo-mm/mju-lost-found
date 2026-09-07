-- Phase I: sanction reasons + audit trail for direct suspensions,
-- suspension appeals, and a nickname-change cooldown.
--
-- Hand-written (not `prisma migrate diff`), same reason as every migration
-- since Phase 23: the live database has columns/indexes from earlier,
-- never-committed work that isn't part of prisma/schema.prisma in this
-- branch.

-- AlterTable: User -- nickname-change cooldown (nullable, existing users
-- unaffected: null means "never changed via /me yet", always allowed).
ALTER TABLE "User" ADD COLUMN "nickname_change_available_at" TIMESTAMP(3);

-- AlterTable: ModerationAction -- report_id becomes optional (a direct
-- admin suspension has no underlying Report), plus a new reason_category
-- column alongside the existing free-text reason. The existing unique
-- index/FK on report_id are left in place -- Postgres unique indexes treat
-- every NULL as distinct, and a NULL foreign key is valid by definition,
-- so neither needs to be dropped/recreated for this change.
ALTER TABLE "ModerationAction" ALTER COLUMN "report_id" DROP NOT NULL;
ALTER TABLE "ModerationAction" ADD COLUMN "reason_category" TEXT;

-- CreateTable: SuspensionAppeal
CREATE TABLE "SuspensionAppeal" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_user_id" INTEGER,

    CONSTRAINT "SuspensionAppeal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_suspension_appeal_user_id" ON "SuspensionAppeal"("user_id");

ALTER TABLE "SuspensionAppeal" ADD CONSTRAINT "SuspensionAppeal_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SuspensionAppeal" ADD CONSTRAINT "SuspensionAppeal_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
