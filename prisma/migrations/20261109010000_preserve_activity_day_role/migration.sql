-- ActivityDay deliberately stores only a one-way actor mark. Its role is
-- supplied by server-side classification, not reconstructed from a user ID.
CREATE OR REPLACE FUNCTION mju_stamp_activity_audience() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor_id integer;
BEGIN
  IF TG_OP='UPDATE' THEN
    NEW.activity_audience := OLD.activity_audience; NEW.activity_role := OLD.activity_role;
    NEW.activity_organization_id := OLD.activity_organization_id; RETURN NEW;
  END IF;
  IF TG_TABLE_NAME='ActivityDay' THEN
    NEW.activity_audience := CASE NEW.activity_role WHEN 'service' THEN 'internal'
      WHEN 'officer' THEN 'internal' WHEN 'member' THEN 'member' ELSE 'unclassified' END;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME='User' THEN
    NEW.activity_role := CASE WHEN NEW.is_admin THEN 'service' WHEN NEW.user_type::text='external_test' THEN 'unclassified' ELSE 'member' END;
    NEW.activity_audience := CASE NEW.activity_role WHEN 'service' THEN 'internal' WHEN 'member' THEN 'member' ELSE 'unclassified' END;
    NEW.activity_organization_id := NULL; RETURN NEW;
  ELSIF TG_TABLE_NAME IN ('LostPost','FoundPost') THEN actor_id:=NEW.user_id;
  ELSIF TG_TABLE_NAME='Message' THEN actor_id:=NEW.sender_user_id;
  ELSIF TG_TABLE_NAME='ChatRoom' THEN actor_id:=NEW.initiator_user_id;
  ELSIF TG_TABLE_NAME='PostStatusChange' THEN actor_id:=NEW.changed_by_user_id;
  ELSIF TG_TABLE_NAME IN ('AdminVisit','AdminActivityLog') THEN actor_id:=NEW.admin_user_id;
  END IF;
  NEW.activity_role:=mju_activity_role(actor_id); NEW.activity_audience:=mju_activity_audience(actor_id);
  NEW.activity_organization_id:=mju_activity_organization(actor_id); RETURN NEW;
END $$;
