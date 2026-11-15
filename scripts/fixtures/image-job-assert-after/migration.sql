-- ISOLATED LOCAL RESTORE ONLY. Reject any changed vector/source or backfill.
DO $$ BEGIN
  IF inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR current_database()<>'verify' THEN
    RAISE EXCEPTION 'D2 assertions require the isolated local verify database';
  END IF;
  IF EXISTS(
    (SELECT 'lost',count(*),count("imageEmbedding"),md5(COALESCE(string_agg(id::text||':'||COALESCE(image_url,'')||':'||COALESCE("imageEmbedding"::text,''),'|' ORDER BY id),'')) FROM public."LostPost"
     UNION ALL SELECT 'found',count(*),count("imageEmbedding"),md5(COALESCE(string_agg(id::text||':'||COALESCE(image_url,'')||':'||COALESCE("imageEmbedding"::text,''),'|' ORDER BY id),'')) FROM public."FoundPost")
    EXCEPT SELECT * FROM d2_rehearsal.original_vectors
  ) THEN RAISE EXCEPTION 'D2 migration changed existing image/vector data'; END IF;
  IF (SELECT count(*) FROM public."ImageEmbeddingJob")<>0 THEN RAISE EXCEPTION 'Unexpected job backfill'; END IF;
  IF (SELECT count(*) FROM public."ImageEmbeddingRuntime" WHERE id=true AND NOT enabled AND resume_at IS NULL)<>1 THEN RAISE EXCEPTION 'Migration did not start paused'; END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='O' AND tgname IN ('lost_image_embedding_job','found_image_embedding_job','lost_image_cache','found_image_cache','lost_image_vector_fence','found_image_vector_fence','image_job_protocol_fence'))<>7 THEN RAISE EXCEPTION 'Missing D2 trigger'; END IF;
  RAISE NOTICE 'D2 existing image/vector digests preserved; no backfill; runtime paused; seven triggers enabled';
END $$;
