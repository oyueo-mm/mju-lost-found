// Explicit read-only DB/Storage/Realtime checks through the existing guard.
import "../db/install-guard.mjs";
import {Client} from "pg";
import {createClient} from "@supabase/supabase-js";
import {assertDatabaseEnvironment,assertScriptSupabaseAccess} from "../../src/lib/db/accessPolicy.mjs";
const target=assertDatabaseEnvironment(process.env,{usage:"operation"});
if(!["production","preview"].includes(target)||assertScriptSupabaseAccess(process.env)!==target)throw new Error("Hosted targets must agree");
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!key)throw new Error("Service credential required");
const db=new Client({connectionString:process.env.DIRECT_URL});
const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,key,{auth:{persistSession:false,autoRefreshToken:false}});
try{
  await db.connect();await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const posts=(await db.query(`SELECT 'lost' type,count(*)::int posts,count("imageEmbedding")::int vectors FROM "LostPost" UNION ALL SELECT 'found',count(*)::int,count("imageEmbedding")::int FROM "FoundPost"`)).rows;
  const evidence=(await db.query(`SELECT count(*) FILTER (WHERE target_snapshot IS NOT NULL)::int snapshots FROM "Report"`)).rows[0];
  const columns=(await db.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name='Report' AND column_name IN ('target_snapshot','snapshot_at','snapshot_purged_at')`)).rows[0].n;
  const triggers=(await db.query(`SELECT count(*)::int n FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='O' AND tgname IN ('lost_image_embedding_job','found_image_embedding_job','lost_image_cache','found_image_cache','lost_image_vector_fence','found_image_vector_fence','image_job_protocol_fence')`)).rows[0].n;
  const tables=(await db.query(`SELECT relname,relrowsecurity,(SELECT count(*)::int FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname) AS client_policies FROM pg_class c WHERE c.oid IN ('public."ImageEmbeddingJob"'::regclass,'public."ImageEmbeddingRuntime"'::regclass) ORDER BY relname`)).rows;
  const jobs=(await db.query(`SELECT state,count(*)::int n FROM "ImageEmbeddingJob" GROUP BY state ORDER BY state`)).rows;
  const failed=(await db.query(`SELECT count(*)::int n FROM "ImageEmbeddingJob" WHERE state='failed' OR (state IN ('pending','running') AND attempts>=5)`)).rows[0].n;
  await db.query("ROLLBACK");
  const bucket=await sb.storage.getBucket("report-evidence");
  const privateEvidence=!bucket.error&&bucket.data?.public===false;
  const statuses={};
  for(const [name,path] of [["dataApi","/rest/v1/"]]){
    const r=await fetch(new URL(path,process.env.NEXT_PUBLIC_SUPABASE_URL),{headers:{apikey:key,Authorization:`Bearer ${key}`},redirect:"error",signal:AbortSignal.timeout(15000)});statuses[name]=r.status;await r.body?.cancel();
  }
  // Hosted /api/health is an admin endpoint (401 with ordinary API keys).
  // Open and close only the WebSocket transport: no room join or event/data.
  try{
    sb.realtime.connect();
    const deadline=Date.now()+15000;
    while(!sb.realtime.isConnected()){
      if(Date.now()>=deadline)throw new Error("Realtime transport timeout");
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    statuses.realtimeTransportOpen=true;
  }finally{await sb.realtime.disconnect();}
  const passed=columns===3&&triggers===7&&tables.length===2&&tables.every(t=>t.relrowsecurity&&t.client_policies===0)&&privateEvidence&&statuses.dataApi===503&&statuses.realtimeTransportOpen===true&&failed===0;
  console.log(JSON.stringify({target,readOnly:true,posts,evidence,snapshotColumns:columns,enabledTriggers:triggers,tables,jobs,failed,privateEvidence,statuses,passed}));if(!passed)process.exitCode=1;
}catch(error){await db.query("ROLLBACK").catch(()=>{});console.error("Read-only D2 health stopped:",error.code??error.name);process.exitCode=1;}
finally{await db.end();}
process.exit(process.exitCode??0);
