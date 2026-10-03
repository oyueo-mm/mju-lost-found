-- Admin chat access audit log + DB-backed rate-limit counters.

CREATE TABLE "AdminAccessLog" (
    "id" SERIAL NOT NULL,
    "admin_user_id" INTEGER NOT NULL,
    "resource" TEXT NOT NULL,
    "chat_room_id" INTEGER NOT NULL,
    "message_id" INTEGER,
    "report_id" INTEGER NOT NULL,
    "accessed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminAccessLog_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "adminaccesslog_resource_check" CHECK ("resource" IN ('chat_room', 'chat_image'))
);
CREATE INDEX "idx_adminaccesslog_admin_accessed" ON "AdminAccessLog"("admin_user_id", "accessed_at");
CREATE INDEX "idx_adminaccesslog_chat_room" ON "AdminAccessLog"("chat_room_id");
ALTER TABLE "AdminAccessLog" ADD CONSTRAINT "AdminAccessLog_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminAccessLog" ADD CONSTRAINT "AdminAccessLog_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "Report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "RateLimitCounter" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "RateLimitCounter_pkey" PRIMARY KEY ("key", "window_start")
);
CREATE INDEX "idx_ratelimitcounter_window_start" ON "RateLimitCounter"("window_start");
