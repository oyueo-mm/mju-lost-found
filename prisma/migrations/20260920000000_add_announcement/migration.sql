-- Phase M: admin announcements, reusing the existing Notification system
-- for delivery (see announcement/service.ts) -- one new table plus one new
-- NotificationType enum value, nothing else. Hand-written, same convention
-- as every migration since Phase 23.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'announcement';

-- CreateTable
CREATE TABLE "Announcement" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_user_id" INTEGER,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
