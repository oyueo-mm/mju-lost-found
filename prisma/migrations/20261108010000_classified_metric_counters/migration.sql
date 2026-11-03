-- Keep historical aggregate counters, whose role definitions were narrower,
-- intact. New application counters have a versioned namespace. Read through
-- this view so no legacy counter is silently asserted to have the new roles.
INSERT INTO "MetricDaily" (day, metric, value)
VALUES ((now() AT TIME ZONE 'Asia/Seoul')::date, 'meta.since.audience_counters',
  extract(hour FROM now() AT TIME ZONE 'Asia/Seoul')::int * 60 + extract(minute FROM now() AT TIME ZONE 'Asia/Seoul')::int)
ON CONFLICT DO NOTHING;

CREATE VIEW "OperationalMetricDaily" AS
  SELECT day, CASE WHEN metric LIKE 'audience_v2.%' THEN substring(metric FROM 13) ELSE metric END AS metric, value
  FROM "MetricDaily"
  WHERE metric LIKE 'audience_v2.%'
     OR (metric NOT LIKE 'visit.%' AND metric NOT LIKE 'search.%' AND metric NOT LIKE 'recommend.%'
       AND metric NOT LIKE 'active.%' AND metric NOT LIKE 'auth.login.%'
       AND metric NOT IN ('meta.since.user_hourly', 'meta.since.traffic_hourly'))
  UNION ALL
  SELECT day, names.metric, value FROM "MetricDaily"
  CROSS JOIN (VALUES ('meta.since.user_hourly'), ('meta.since.traffic_hourly')) AS names(metric)
  WHERE "MetricDaily".metric = 'meta.since.audience_counters';
