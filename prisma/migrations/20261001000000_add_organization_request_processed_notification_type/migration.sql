-- Phase 12-3: one new NotificationType enum value, nothing else -- same
-- shape as 20260920000000_add_announcement's own single ALTER TYPE
-- (adding 'announcement'). Sent to exactly one recipient (the requester)
-- when their OrganizationCreationRequest is approved or rejected -- see
-- schema.prisma's own comment on this enum value and
-- organization/service.ts's approveOrganizationCreationRequest/
-- rejectOrganizationCreationRequest for where it's actually created.
-- Hand-written, same convention as every migration since Phase 23.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'organization_request_processed';
