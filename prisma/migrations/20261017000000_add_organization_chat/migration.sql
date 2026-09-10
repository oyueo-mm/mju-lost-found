-- Phase 12-11 §4/§6/§7/§20: adds organization-inquiry chat rooms without
-- disturbing any existing personal ChatRoom row. counterpart_user_id
-- drops NOT NULL (every existing row keeps its existing value -- this is
-- purely a constraint relaxation, no UPDATE touches existing data);
-- organization_id is added nullable and stays NULL for every row that
-- exists today. A CHECK constraint is what actually enforces the
-- "exactly one of counterpart_user_id/organization_id" invariant at the
-- DB level (Prisma's schema.prisma has no first-class CHECK syntax, so
-- this exists only in the migration, not mirrored in schema.prisma --
-- same "hand-written SQL can do more than the generator" precedent this
-- project already established for partial-unique-index equivalents via
-- NULL semantics, see ChatRoom's own top-of-model comment).

-- AlterTable: relax counterpart_user_id, add the new NotificationType enum
-- value and organization_id.
ALTER TABLE "ChatRoom" ALTER COLUMN "counterpart_user_id" DROP NOT NULL;
ALTER TABLE "ChatRoom" ADD COLUMN "organization_id" INTEGER;

ALTER TYPE "NotificationType" ADD VALUE 'organization_chat_received';

-- AddForeignKey
ALTER TABLE "ChatRoom" ADD CONSTRAINT "ChatRoom_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "idx_chatroom_organization_id" ON "ChatRoom"("organization_id");

-- The organization-inquiry equivalent of idx_chatroom_direct_{lost,found}_unique
-- (post, initiator, counterpart) -- see schema.prisma's own comment on why
-- both constraint pairs can coexist without ever colliding with each other
-- (each targets a column that's always NULL on the other shape's rows).
CREATE UNIQUE INDEX "idx_chatroom_direct_lost_org_unique" ON "ChatRoom"("direct_lost_post_id", "initiator_user_id", "organization_id");
CREATE UNIQUE INDEX "idx_chatroom_direct_found_org_unique" ON "ChatRoom"("direct_found_post_id", "initiator_user_id", "organization_id");

-- DB-level invariant backstop (application code in chat/service.ts is the
-- primary enforcement, same as every other "exactly one of two nullable
-- columns" rule in this schema -- this CHECK exists purely so a future bug
-- can never silently insert a row with both or neither set).
ALTER TABLE "ChatRoom" ADD CONSTRAINT "chatroom_counterpart_xor_organization"
  CHECK (
    ("counterpart_user_id" IS NOT NULL AND "organization_id" IS NULL)
    OR
    ("counterpart_user_id" IS NULL AND "organization_id" IS NOT NULL)
  );
