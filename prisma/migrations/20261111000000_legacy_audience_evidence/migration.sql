-- Additive, one transaction. No stored row is changed.
--
-- Rows written before the event-time audience/role snapshot (activity_audience
-- IS NULL) were being dropped from every member statistic. They are classified
-- at read time instead, only from recorded evidence:
--   * a full administrator can only be granted/removed through an executed
--     AdminActionProposal (grant_admin / revoke_admin, AdminActionAuditLog
--     'executed'); an account's admin state at a moment follows the last such
--     event before it;
--   * a current administrator with no such event (the first, bootstrapped one)
--     is an administrator from its first recorded administrative act on; before
--     that its state is unknown;
--   * every other account has never been an administrator.
-- Accounts are always created as non-administrators (auth/user.ts), so a sign-up
-- is a member sign-up unless the account is a Google test-mode account. Nothing
-- that cannot be shown this way is guessed: it is 'unclassified'.
BEGIN;

CREATE OR REPLACE FUNCTION mju_admin_at(uid integer, at timestamp) RETURNS boolean LANGUAGE sql STABLE AS $$
  WITH ev AS (
    SELECT l.created_at AS t, p.action_type::text AS a
    FROM "AdminActionAuditLog" l JOIN "AdminActionProposal" p ON p.id = l.proposal_id
    WHERE p.target_user_id = uid AND l.event::text = 'executed' AND p.action_type::text IN ('grant_admin', 'revoke_admin')
  ), acts AS (
    SELECT min(t) AS t FROM (
      SELECT created_at AS t FROM "AdminActionProposal" WHERE proposed_by_user_id = uid
      UNION ALL SELECT created_at FROM "AdminActionApproval" WHERE approved_by_user_id = uid
      UNION ALL SELECT created_at FROM "ModerationAction" WHERE admin_user_id = uid
      UNION ALL SELECT created_at FROM "AdminActivityLog" WHERE admin_user_id = uid
      UNION ALL SELECT started_at FROM "AdminVisit" WHERE admin_user_id = uid
    ) x
  )
  SELECT CASE
    WHEN uid IS NULL OR at IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM ev WHERE ev.t <= at) THEN (SELECT ev.a = 'grant_admin' FROM ev WHERE ev.t <= at ORDER BY ev.t DESC LIMIT 1)
    -- before the first recorded change: not an admin if that change granted it; unknown if it removed it
    WHEN EXISTS (SELECT 1 FROM ev) THEN (SELECT CASE WHEN ev.a = 'grant_admin' THEN false END FROM ev ORDER BY ev.t LIMIT 1)
    WHEN (SELECT u.is_admin FROM "User" u WHERE u.id = uid) THEN CASE WHEN at >= (SELECT acts.t FROM acts) THEN true END
    WHEN EXISTS (SELECT 1 FROM "User" u WHERE u.id = uid) THEN false
  END
$$;

CREATE OR REPLACE FUNCTION mju_legacy_audience(uid integer, at timestamp) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN (SELECT u.user_type::text FROM "User" u WHERE u.id = uid) = 'external_test' THEN 'unclassified'
    ELSE CASE mju_admin_at(uid, at) WHEN true THEN 'internal' WHEN false THEN 'member' ELSE 'unclassified' END
  END
$$;

CREATE OR REPLACE FUNCTION mju_legacy_role(uid integer, at timestamp) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE mju_legacy_audience(uid, at) WHEN 'internal' THEN 'service' WHEN 'member' THEN 'member' ELSE 'unclassified' END
$$;

CREATE OR REPLACE FUNCTION mju_legacy_signup_audience(uid integer) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN u.user_type::text = 'external_test' THEN 'unclassified' ELSE 'member' END FROM "User" u WHERE u.id = uid
$$;

-- An ActivityDay mark keeps only the KST day: the state must be the same for
-- the whole day, otherwise (promoted or demoted that day) it is unclassified.
CREATE OR REPLACE FUNCTION mju_legacy_day_audience(uid integer, d date) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN s = e THEN s ELSE 'unclassified' END
  FROM (SELECT mju_legacy_audience(uid, d::timestamp - interval '9 hours') AS s,
               mju_legacy_audience(uid, d::timestamp + interval '15 hours' - interval '1 millisecond') AS e) x
$$;

-- Counters written before audience_v3 were already split by the server at
-- collection time (anon / member / internal = full administrator), the only
-- roles that existed then. They are read again, under the same names as the
-- audience_v3 counters (whose prefix is stripped); the two never overlap in
-- time, and rows of the same day and name are added. The meta.since markers
-- keep their own days again.
DROP VIEW "OperationalMetricDaily";
CREATE VIEW "OperationalMetricDaily" AS
  SELECT day, metric, sum(value)::integer AS value FROM (
    SELECT day,
      CASE WHEN metric LIKE 'audience_v3.%' THEN substring(metric FROM 13)
        WHEN metric LIKE 'audience_v2.%' THEN CASE
          WHEN substring(metric FROM 13) LIKE '%.internal' OR substring(metric FROM 13) LIKE 'visit.internal.%'
            THEN 'legacy.' || substring(metric FROM 13) ELSE substring(metric FROM 13) END
        ELSE metric END AS metric,
      value
    FROM "MetricDaily"
    WHERE metric LIKE 'audience_v3.%' OR metric LIKE 'audience_v2.%'
      OR (metric NOT LIKE 'visit.%' AND metric NOT LIKE 'search.%' AND metric NOT LIKE 'recommend.%'
        AND metric NOT LIKE 'active.%' AND metric NOT LIKE 'auth.login.%')
      OR day <= COALESCE((SELECT min(m.day) FROM "MetricDaily" m WHERE m.metric = 'meta.since.audience_snapshot'), day)
  ) x
  GROUP BY day, metric;

COMMIT;
