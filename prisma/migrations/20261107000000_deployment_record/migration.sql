-- 개발자 통계 > 배포 이력: one row per Vercel deployment, kept after Vercel
-- deletes the deployment (see schema.prisma DeploymentRecord). Additive
-- only; no backfill -- deployments Vercel has already deleted are not
-- recreated.
BEGIN;

CREATE TABLE "DeploymentRecord" (
    "id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "url" TEXT,
    "git_sha" TEXT,
    "git_message" TEXT,
    "git_dirty" BOOLEAN,
    "state" TEXT,
    "created_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "first_seen_at" TIMESTAMP(3),
    "current_at" TIMESTAMP(3),
    "sources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeploymentRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_deploymentrecord_created" ON "DeploymentRecord"("created_at");

COMMIT;
