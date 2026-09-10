-- Phase 12-2: DB groundwork for organization/group accounts -- 3 new
-- enums + 4 new tables, no change to any existing table/column. See the
-- Phase 12-1 design report for the full rationale; see each model's own
-- comment in schema.prisma for why each choice (Cascade vs Restrict,
-- shared OrganizationRequestStatus enum, no publicId on Organization,
-- etc.) was made. Hand-written, same convention as every migration since
-- Phase 23.

-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('leader', 'admin', 'member');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "OrganizationRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- CreateTable
CREATE TABLE "Organization" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "organization_type" TEXT NOT NULL,
    "scope" TEXT,
    "contact_email" TEXT,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_organization_status" ON "Organization"("status");

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" "OrganizationRole" NOT NULL DEFAULT 'member',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_organization_id_user_id_key" ON "OrganizationMember"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_org_member_user_id" ON "OrganizationMember"("user_id");

-- CreateIndex
CREATE INDEX "idx_org_member_org_role" ON "OrganizationMember"("organization_id", "role");

-- CreateTable
CREATE TABLE "OrganizationCreationRequest" (
    "id" SERIAL NOT NULL,
    "requested_by_user_id" INTEGER NOT NULL,
    "organization_name" TEXT NOT NULL,
    "organization_type" TEXT NOT NULL,
    "scope" TEXT,
    "contact_email" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" "OrganizationRequestStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by_user_id" INTEGER,
    "reviewed_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "admin_note" TEXT,
    "resulting_organization_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationCreationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationCreationRequest_resulting_organization_id_key" ON "OrganizationCreationRequest"("resulting_organization_id");

-- CreateIndex
CREATE INDEX "idx_org_creation_request_status" ON "OrganizationCreationRequest"("status");

-- CreateTable
CREATE TABLE "OrganizationJoinRequest" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "message" TEXT,
    "status" "OrganizationRequestStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by_user_id" INTEGER,
    "reviewed_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationJoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_org_join_request_org_status" ON "OrganizationJoinRequest"("organization_id", "status");

-- Phase 12-2: "동일 조직에 PENDING 가입 요청 중복 방지" -- a partial unique
-- index, same technique as PostImage's own idx_postimage_lost_primary_unique
-- (see that migration) -- NULLs/non-matching rows never collide in a
-- unique index, so a user with a REJECTED/CANCELLED/APPROVED request can
-- still file a fresh one; only two simultaneous PENDING rows for the same
-- (organization, user) pair are rejected.
CREATE UNIQUE INDEX "idx_org_join_request_pending_unique" ON "OrganizationJoinRequest"("organization_id", "user_id") WHERE "status" = 'pending';

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationCreationRequest" ADD CONSTRAINT "OrganizationCreationRequest_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationCreationRequest" ADD CONSTRAINT "OrganizationCreationRequest_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationJoinRequest" ADD CONSTRAINT "OrganizationJoinRequest_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationJoinRequest" ADD CONSTRAINT "OrganizationJoinRequest_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationJoinRequest" ADD CONSTRAINT "OrganizationJoinRequest_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
