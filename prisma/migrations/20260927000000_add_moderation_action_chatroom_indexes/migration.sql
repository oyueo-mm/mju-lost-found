-- Phase 11-3: index-only migration, no data changed. Added only after
-- confirming each is a real, already-existing query shape in the
-- codebase (not speculative) -- see schema.prisma's own comments on
-- ModerationAction/ChatRoom for exactly which query each one serves.
--
-- Report.targetId and ChatRead.userId were also investigated this phase
-- and deliberately NOT indexed: no query anywhere filters Report by
-- targetId alone, and every ChatRead query already uses the full
-- (chatRoomId, userId) composite unique key, which Postgres already
-- backs with an index.
--
-- Hand-written (not `prisma migrate diff`), same reason as every
-- migration since Phase 23 -- see e.g. 20260926000000_add_user_deleted_at.

-- CreateIndex
CREATE INDEX "idx_moderation_action_type_created" ON "ModerationAction"("action_type", "created_at");

-- CreateIndex
CREATE INDEX "idx_moderation_action_target" ON "ModerationAction"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "idx_chatroom_initiator_user_id" ON "ChatRoom"("initiator_user_id");
