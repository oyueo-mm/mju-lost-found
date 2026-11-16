// Production must use approved-operation.mjs and the separately approved
// signing trust. This tool never changes signing keys or project auth config.
import "../db/install-guard.mjs";
import {Client} from "pg";
import {readFileSync,readdirSync} from "node:fs";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {assertDatabaseEnvironment,PREVIEW_DB_PROJECT,PRODUCTION_DB_PROJECT} from "../../src/lib/db/accessPolicy.mjs";
import {PREVIEW_HISTORICAL_MIGRATIONS} from "./release-d2-policy.mjs";
import {checkD3Migrations} from "./release-d3-policy.mjs";
import {captureRealtimeAuthorization,assertRealtimeAuthorization} from "../backup/realtime-authorization.mjs";
const [action,...flags]=process.argv.slice(2);
if(!["status","preflight","migrate","polling","private"].includes(action))throw new Error("Unknown D3 operation");
const target=assertDatabaseEnvironment(process.env,{usage:"operation"});
if(!["preview","production"].includes(target))throw new Error("Hosted target required");
const apply=flags.includes("--apply"),confirmation=`--confirm-${target}`;
let kid;
for(let i=0;i<flags.length;i++){
  if(["--apply",confirmation].includes(flags[i]))continue;
  if(flags[i]==="--kid"&&/^[0-9a-f-]{36}$/i.test(flags[i+1]??"")){kid=flags[++i];continue;}
  throw new Error("Unexpected D3 option");
}
if(apply&&!flags.includes(confirmation))throw new Error("Target confirmation required");
if(apply&&["status","preflight"].includes(action))throw new Error("Read-only D3 action cannot apply changes");
const checksums=Object.fromEntries(readdirSync("prisma/migrations",{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>{
  const s=readFileSync(resolve("prisma/migrations",d.name,"migration.sql"),"utf8").replaceAll("\r\n","\n");
  return [d.name,[s,s.replaceAll("\n","\r\n")].map(v=>createHash("sha256").update(v).digest("hex"))];
}));
const db=new Client({connectionString:process.env.DIRECT_URL});
async function history(){return(await db.query(`SELECT migration_name,checksum,finished_at IS NOT NULL applied,rolled_back_at IS NOT NULL rolled_back FROM _prisma_migrations ORDER BY started_at`)).rows;}
async function state(){
  const present=(await db.query(`SELECT to_regclass('public."ChatRealtimeConfig"') IS NOT NULL present`)).rows[0].present;
  if(!present)return {present};
  const config=(await db.query(`SELECT mode,project_ref,signing_kid FROM "ChatRealtimeConfig" WHERE id=true`)).rows[0];
  const counts=(await db.query(`SELECT count(*)::int total,count(*) FILTER(WHERE revoked_at IS NULL AND expires_at>(now() AT TIME ZONE 'UTC'))::int active FROM "ChatRealtimeGrant"`)).rows[0];
  const authorization=await captureRealtimeAuthorization(db);assertRealtimeAuthorization(authorization);
  const tables=(await db.query(`SELECT c.relname,c.relrowsecurity,(SELECT count(*)::int FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname) AS policies FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('ChatRealtimeSession','ChatRealtimeGrant','ChatRealtimeConfig') ORDER BY c.relname`)).rows;
  const effectiveContentGrants=(await db.query(`SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','storage') AND c.relkind IN ('r','p') AND has_table_privilege('mju_chat_realtime',c.oid,'SELECT,INSERT,UPDATE,DELETE')`)).rows[0].n;
  if(tables.length!==3||tables.some(t=>!t.relrowsecurity||t.policies!==0)||effectiveContentGrants!==0)throw new Error("Unexpected D3 content privileges or table RLS");
  return {present,config,counts,tables,effectiveContentGrants,authorization};
}
try{
  await db.connect();await db.query("BEGIN READ ONLY");
  const pending=checkD3Migrations(checksums,await history(),target==="preview"?PREVIEW_HISTORICAL_MIGRATIONS:{});
  console.log(JSON.stringify({target,action,apply,pending,state:await state()}));await db.query("ROLLBACK");
  if(apply&&action==="migrate"&&pending.length){
    const r=spawnSync(process.execPath,["--import",new URL("../db/install-guard.mjs",import.meta.url).href,resolve("node_modules/prisma/build/index.js"),"migrate","deploy","--config",resolve("prisma7.config.ts")],{env:{...process.env,PGOPTIONS:"-c lock_timeout=5000 -c statement_timeout=60000"},encoding:"utf8",timeout:120000,maxBuffer:4*1024*1024,windowsHide:true});
    if(r.status!==0||r.error)throw new Error("D3 migration failed; inspect history before retry; diagnostics suppressed");
  }
  if(apply&&["private","polling"].includes(action)){
    if(pending.length)throw new Error("Finish D3 migrations before changing runtime mode");
    const project=target==="preview"?PREVIEW_DB_PROJECT:PRODUCTION_DB_PROJECT;
    if(action==="private"){
      if(!kid)throw new Error("Verified public signing kid required");
      const r=await fetch(`https://${project}.supabase.co/auth/v1/.well-known/jwks.json`,{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15000)});
      if(!r.ok||!(await r.json()).keys?.some(k=>k.kid===kid&&k.alg==="ES256"&&k.kty==="EC"&&k.crv==="P-256"))throw new Error("Signing key is not published by the target project");
    }
    await db.query("BEGIN");
    // Old tokens/topics never resume after a mode/key transition.
    await db.query(`UPDATE "ChatRealtimeConfig" SET mode='polling' WHERE id=true`);
    await db.query(`UPDATE "ChatRealtimeGrant" SET revoked_at=(now() AT TIME ZONE 'UTC') WHERE revoked_at IS NULL`);
    if(action==="private")await db.query(`UPDATE "ChatRealtimeConfig" SET mode='private',project_ref=$1,signing_kid=$2 WHERE id=true`,[project,kid]);
    await db.query("COMMIT");
  }
  await db.query("BEGIN READ ONLY");
  const remaining=checkD3Migrations(checksums,await history(),target==="preview"?PREVIEW_HISTORICAL_MIGRATIONS:{});
  if(apply&&action==="migrate"&&remaining.length)throw new Error("D3 migration incomplete");
  console.log(JSON.stringify({target,action,remaining,state:await state()}));await db.query("ROLLBACK");
}catch(error){await db.query("ROLLBACK").catch(()=>{});console.error("D3 operation stopped:",error.code??error.message);process.exitCode=1;}
finally{await db.end();}
