-- Phase 관리자 승인제: two-admin-approval workflow for high-risk actions
-- targeting another admin (suspend/unsuspend/grant/revoke) -- three new
-- tables, three new enums, no change to any existing table/column. See
-- each model's own comment in schema.prisma for the full rationale.
-- Hand-written, same convention as every migration since Phase 23.

-- CreateEnum
CREATE TYPE "AdminActionProposalType" AS ENUM ('suspend_user', 'unsuspend_user', 'grant_admin', 'revoke_admin');

-- CreateEnum
CREATE TYPE "AdminActionProposalStatus" AS ENUM ('pending', 'executed', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "AdminActionAuditEvent" AS ENUM ('created', 'approved', 'executed', 'cancelled', 'expired');

-- CreateTable
CREATE TABLE "AdminActionProposal" (
    "id" SERIAL NOT NULL,
    "target_user_id" INTEGER NOT NULL,
    "action_type" "AdminActionProposalType" NOT NULL,
    "reason_category" TEXT,
    "reason" TEXT,
    "suspend_duration_days" INTEGER,
    "status" "AdminActionProposalStatus" NOT NULL DEFAULT 'pending',
    "proposed_by_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "executed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_user_id" INTEGER,

    CONSTRAINT "AdminActionProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_admin_action_proposal_status" ON "AdminActionProposal"("status");

-- CreateIndex
CREATE INDEX "idx_admin_action_proposal_target" ON "AdminActionProposal"("target_user_id");

-- CreateTable
CREATE TABLE "AdminActionApproval" (
    "id" SERIAL NOT NULL,
    "proposal_id" INTEGER NOT NULL,
    "approved_by_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminActionApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: the actual backstop against a double approval by the same
-- admin -- see AdminActionApproval's own schema.prisma comment.
CREATE UNIQUE INDEX "idx_admin_action_approval_unique" ON "AdminActionApproval"("proposal_id", "approved_by_user_id");

-- CreateIndex
CREATE INDEX "idx_admin_action_approval_proposal" ON "AdminActionApproval"("proposal_id");

-- CreateTable
CREATE TABLE "AdminActionAuditLog" (
    "id" SERIAL NOT NULL,
    "proposal_id" INTEGER NOT NULL,
    "event" "AdminActionAuditEvent" NOT NULL,
    "actor_user_id" INTEGER,
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminActionAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_admin_action_audit_proposal" ON "AdminActionAuditLog"("proposal_id");

-- AddForeignKey
ALTER TABLE "AdminActionProposal" ADD CONSTRAINT "AdminActionProposal_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminActionProposal" ADD CONSTRAINT "AdminActionProposal_proposed_by_user_id_fkey" FOREIGN KEY ("proposed_by_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminActionProposal" ADD CONSTRAINT "AdminActionProposal_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminActionApproval" ADD CONSTRAINT "AdminActionApproval_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "AdminActionProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminActionApproval" ADD CONSTRAINT "AdminActionApproval_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminActionAuditLog" ADD CONSTRAINT "AdminActionAuditLog_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "AdminActionProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminActionAuditLog" ADD CONSTRAINT "AdminActionAuditLog_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
