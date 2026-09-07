-- Phase H-3: single-row global settings table (id=1) -- currently only
-- backs the admin-toggleable "일반 Google 계정 테스트 허용" gate consulted
-- by the NextAuth signIn callback. No seed row is inserted here on
-- purpose -- getAppSettings() (src/lib/settings/service.ts) treats a
-- missing row the same as googleTestModeEnabled=false and creates the
-- row lazily on first read/write, so a fresh deploy is never accidentally
-- open before an admin ever touches this setting.

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" INTEGER NOT NULL,
    "google_test_mode_enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_user_id" INTEGER,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AppSettings" ADD CONSTRAINT "AppSettings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
