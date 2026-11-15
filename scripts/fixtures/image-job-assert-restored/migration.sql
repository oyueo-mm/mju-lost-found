-- ISOLATED LOCAL RESTORE ONLY. Inspect D2 tables from an actual post-release
-- dump, rather than creating them by replaying migrations after restoration.
DO $$ DECLARE jobs bigint; runtime bigint;
BEGIN
  IF inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR current_database()<>'verify' THEN
    RAISE EXCEPTION 'D2 assertions require the isolated local verify database';
  END IF;
  -- A restored Supabase vector extension lives in extensions; this psql
  -- session does not inherit the hosted postgres role's search_path.
  PERFORM set_config('search_path','public,extensions,pg_catalog',true);
  SELECT count(*) INTO jobs FROM public."ImageEmbeddingJob";
  SELECT count(*) INTO runtime FROM public."ImageEmbeddingRuntime";
  IF runtime<>1 THEN RAISE EXCEPTION 'D2 runtime singleton did not restore'; END IF;
  IF (SELECT count(*) FROM pg_class WHERE oid IN ('public."ImageEmbeddingJob"'::regclass,'public."ImageEmbeddingRuntime"'::regclass) AND relrowsecurity)<>2 THEN RAISE EXCEPTION 'D2 RLS did not restore'; END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='O' AND tgname IN ('lost_image_embedding_job','found_image_embedding_job','lost_image_cache','found_image_cache','lost_image_vector_fence','found_image_vector_fence','image_job_protocol_fence'))<>7 THEN RAISE EXCEPTION 'D2 triggers did not restore'; END IF;
  IF EXISTS(SELECT 1 FROM public."LostPost" WHERE "imageEmbedding" IS NOT NULL AND vector_dims("imageEmbedding")<>768 UNION ALL SELECT 1 FROM public."FoundPost" WHERE "imageEmbedding" IS NOT NULL AND vector_dims("imageEmbedding")<>768) THEN RAISE EXCEPTION 'Restored vector dimensions differ'; END IF;
  RAISE NOTICE 'D2 restored from dump: ImageEmbeddingJob rows %, ImageEmbeddingRuntime rows %, RLS 2, enabled triggers 7, vector dimensions 768',jobs,runtime;
END $$;
