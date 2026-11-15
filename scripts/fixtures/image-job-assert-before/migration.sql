-- ISOLATED LOCAL RESTORE ONLY. Preserve a digest before rehearsal DDL.
DO $$ BEGIN
  IF inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR current_database()<>'verify' THEN
    RAISE EXCEPTION 'D2 assertions require the isolated local verify database';
  END IF;
END $$;
CREATE SCHEMA d2_rehearsal;
CREATE TABLE d2_rehearsal.original_vectors AS
SELECT 'lost' AS type,count(*) AS posts,count("imageEmbedding") AS vectors,
  md5(COALESCE(string_agg(id::text||':'||COALESCE(image_url,'')||':'||COALESCE("imageEmbedding"::text,''),'|' ORDER BY id),'')) AS digest
FROM public."LostPost"
UNION ALL SELECT 'found',count(*),count("imageEmbedding"),
  md5(COALESCE(string_agg(id::text||':'||COALESCE(image_url,'')||':'||COALESCE("imageEmbedding"::text,''),'|' ORDER BY id),''))
FROM public."FoundPost";
