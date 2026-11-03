-- Additive only. Historical audience is intentionally unknown (NULL).
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'post_managed';
ALTER TABLE "ExternalAccessGrant" ADD COLUMN "can_manage_items" boolean NOT NULL DEFAULT false;
ALTER TABLE "FoundPost" ADD COLUMN "custody" jsonb;
ALTER TABLE "PostStatusChange" ADD COLUMN "action" text, ADD COLUMN "institution" text,
  ADD COLUMN "before_custody" jsonb, ADD COLUMN "after_custody" jsonb;

CREATE FUNCTION mju_activity_audience(actor_id integer) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN u.is_admin OR u.user_type::text = 'external_test'
    OR EXISTS (SELECT 1 FROM "ExternalAccessGrant" g WHERE lower(g.email) = lower(u.email) AND g.status::text = 'active' AND g.can_manage_items)
    OR EXISTS (SELECT 1 FROM "OrganizationMember" m JOIN "Organization" o ON o.id = m.organization_id
      WHERE m.user_id = u.id AND m.role::text IN ('leader','admin') AND o.status::text = 'active')
    THEN 'internal' ELSE 'member' END FROM "User" u WHERE u.id = actor_id
$$;

ALTER TABLE "User" ADD COLUMN "activity_audience" text;
ALTER TABLE "LostPost" ADD COLUMN "activity_audience" text;
ALTER TABLE "FoundPost" ADD COLUMN "activity_audience" text;
ALTER TABLE "ChatRoom" ADD COLUMN "activity_audience" text;
ALTER TABLE "Message" ADD COLUMN "activity_audience" text;
ALTER TABLE "PostStatusChange" ADD COLUMN "activity_audience" text;
ALTER TABLE "ActivityDay" ADD COLUMN "activity_audience" text;

CREATE FUNCTION mju_stamp_activity_audience() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor_id integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.activity_audience := OLD.activity_audience;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'User' THEN
    -- BEFORE INSERT: NEW is not visible to mju_activity_audience yet.
    NEW.activity_audience := CASE WHEN NEW.is_admin OR NEW.user_type::text = 'external_test'
      OR EXISTS (SELECT 1 FROM "ExternalAccessGrant" g WHERE lower(g.email) = lower(NEW.email) AND g.status::text = 'active' AND g.can_manage_items)
      THEN 'internal' ELSE 'member' END;
    RETURN NEW;
  ELSIF TG_TABLE_NAME IN ('LostPost', 'FoundPost') THEN actor_id := NEW.user_id;
  ELSIF TG_TABLE_NAME = 'Message' THEN actor_id := NEW.sender_user_id;
  ELSIF TG_TABLE_NAME = 'ChatRoom' THEN actor_id := NEW.initiator_user_id;
  ELSIF TG_TABLE_NAME = 'PostStatusChange' THEN actor_id := NEW.changed_by_user_id;
  END IF;
  NEW.activity_audience := mju_activity_audience(actor_id);
  RETURN NEW;
END $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['User','LostPost','FoundPost','ChatRoom','Message','PostStatusChange'] LOOP
    EXECUTE format('CREATE TRIGGER stamp_activity_audience BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION mju_stamp_activity_audience()', t);
  END LOOP;
END $$;

-- Collection boundary, not an event count. Deployment applies this only to
-- the explicitly selected database; never rewrite pre-migration data.
INSERT INTO "MetricDaily" (day, metric, value)
VALUES ((now() AT TIME ZONE 'Asia/Seoul')::date, 'meta.since.audience_snapshot', 1)
ON CONFLICT DO NOTHING;
CREATE INDEX "idx_post_status_change_audience" ON "PostStatusChange" (activity_audience, created_at);
