-- 회원탈퇴 (irreversible withdrawal), separate from the existing reversible
-- deactivation (User.deleted_at). Additive only: no existing row changes.

ALTER TABLE "User" ADD COLUMN "withdrawn_at" TIMESTAMP(3);
ALTER TABLE "LostPost" ADD COLUMN "removed_at" TIMESTAMP(3);
ALTER TABLE "FoundPost" ADD COLUMN "removed_at" TIMESTAMP(3);

CREATE TYPE "WithdrawnIdentityStatus" AS ENUM ('active', 'resolved');
CREATE TYPE "RejoinRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

-- No e-mail or Google ID is stored: only an HMAC under a server-side secret.
CREATE TABLE "WithdrawnIdentity" (
    "id" SERIAL NOT NULL,
    "identity_hmac" TEXT,
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "withdrawn_user_id" INTEGER NOT NULL,
    "reasons" TEXT[],
    "status" "WithdrawnIdentityStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    CONSTRAINT "WithdrawnIdentity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WithdrawnIdentity_identity_hmac_key" ON "WithdrawnIdentity"("identity_hmac");
ALTER TABLE "WithdrawnIdentity" ADD CONSTRAINT "WithdrawnIdentity_withdrawn_user_id_fkey" FOREIGN KEY ("withdrawn_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "RejoinRequest" (
    "id" SERIAL NOT NULL,
    "identity_id" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RejoinRequestStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_user_id" INTEGER,
    "review_note" TEXT,
    "consumed_at" TIMESTAMP(3),
    CONSTRAINT "RejoinRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_rejoin_request_identity" ON "RejoinRequest"("identity_id");
CREATE INDEX "idx_rejoin_request_status_created" ON "RejoinRequest"("status", "created_at");
ALTER TABLE "RejoinRequest" ADD CONSTRAINT "RejoinRequest_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "WithdrawnIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RejoinRequest" ADD CONSTRAINT "RejoinRequest_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
