-- Phase 12-9 §2: 3 new NotificationType values so a Platform Admin gets
-- notified the moment a new Report/Feedback/SuspensionAppeal is filed --
-- distinct from the existing REPORT_PROCESSED (which goes to the
-- *reporter*, after processing). No table changes, purely additive enum
-- values. Hand-written, same convention as every migration since Phase 23.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'report_received';
ALTER TYPE "NotificationType" ADD VALUE 'feedback_received';
ALTER TYPE "NotificationType" ADD VALUE 'suspension_appeal_received';
