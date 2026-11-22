BEGIN;
-- Security audit A-3: every signed upload URL the app mints is recorded, so
-- (1) a member's not-yet-attached uploads can be capped and (2) uploads never
-- attached are found and removed without listing whole buckets.
-- Additive only: a new table, no existing row changes. A deployment without
-- this code ignores it.
CREATE TABLE public."UploadIntent" (
  path text PRIMARY KEY,
  bucket text NOT NULL CHECK (bucket IN ('post-images','chat-images')),
  user_id integer NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  created_at timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  attached_at timestamp(3),
  deleted_at timestamp(3)
);
CREATE INDEX "UploadIntent_user_open" ON public."UploadIntent" (user_id, created_at) WHERE attached_at IS NULL AND deleted_at IS NULL;
CREATE INDEX "UploadIntent_open" ON public."UploadIntent" (created_at) WHERE attached_at IS NULL AND deleted_at IS NULL;

-- Server-only. No client policies; drop anything a default ACL granted.
ALTER TABLE public."UploadIntent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."UploadIntent" FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public."UploadIntent" FROM %I', r);
    END IF;
  END LOOP;
END $$;
COMMIT;
