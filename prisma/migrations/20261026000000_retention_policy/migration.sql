-- Retention policy: a WithdrawnIdentity is deleted as soon as its purpose
-- ends; a processed RejoinRequest (the admin decision record) outlives it
-- and is removed 1 year after review. Existing rows are unchanged.
ALTER TABLE "RejoinRequest" ALTER COLUMN "identity_id" DROP NOT NULL;
ALTER TABLE "RejoinRequest" DROP CONSTRAINT "RejoinRequest_identity_id_fkey";
ALTER TABLE "RejoinRequest" ADD CONSTRAINT "RejoinRequest_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "WithdrawnIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
