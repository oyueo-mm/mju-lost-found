-- This server-only queue must not become readable through client roles if
-- Data API or Realtime configuration changes later. No client policies.
ALTER TABLE "ImageEmbeddingJob" ENABLE ROW LEVEL SECURITY;
