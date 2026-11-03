-- Unlike user-ID event tables, ActivityDay previously relied on application
-- writes alone. Protect its event-time classification on updates as well.
CREATE TRIGGER stamp_activity_audience BEFORE INSERT OR UPDATE ON "ActivityDay"
FOR EACH ROW EXECUTE FUNCTION mju_stamp_activity_audience();
