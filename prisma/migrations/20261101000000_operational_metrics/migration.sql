-- 운영 통계: only what the existing tables can't answer. Sign-ups, posts,
-- chats, messages and returns are counted from their own tables; these hold
-- the rest, with no search text and no user id in the clear.
BEGIN;

-- Per-day counters (KST day): searches by kind, recommendations shown.
CREATE TABLE "MetricDaily" (
    "day" DATE NOT NULL,
    "metric" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "MetricDaily_pkey" PRIMARY KEY ("day", "metric")
);

-- Active members: one row per member per KST day; `actor` is an HMAC of the
-- user id (not reversible without the server secret), so the table can
-- count distinct members per day/week/month without naming anyone.
CREATE TABLE "ActivityDay" (
    "day" DATE NOT NULL,
    "actor" TEXT NOT NULL,
    CONSTRAINT "ActivityDay_pkey" PRIMARY KEY ("day", "actor")
);

-- API timings per hour and route: request and error counts, total time and
-- a fixed latency histogram (p50/p95 are read from it).
CREATE TABLE "ApiMetricHourly" (
    "hour" TIMESTAMP(3) NOT NULL,
    "route" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "total_ms" BIGINT NOT NULL DEFAULT 0,
    "buckets" INTEGER[] NOT NULL,
    CONSTRAINT "ApiMetricHourly_pkey" PRIMARY KEY ("hour", "route")
);

COMMIT;
