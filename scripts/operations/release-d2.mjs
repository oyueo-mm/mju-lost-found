// Production: only via approved-operation.mjs with a one-off D2 reference.
// Writes are restricted to approved D2 DDL/Prisma history and the new singleton
// runtime switch. This tool never recomputes or mutates user content/vectors.
import "../db/install-guard.mjs";
import { Client } from "pg";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";
import { checkD2Migrations, LEGACY_DRAIN_SECONDS, PREVIEW_HISTORICAL_MIGRATIONS } from "./release-d2-policy.mjs";
import { pgConfig } from "../db/pgConfig.mjs";
const [action, ...flags] = process.argv.slice(2);
if (!["preflight", "migrate", "arm", "pause", "status"].includes(action)) throw new Error("Unknown D2 operation");
const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
if (!["production", "preview"].includes(target)) throw new Error("Explicit hosted target required");
const confirm = target === "production" ? "--confirm-production" : "--confirm-preview";
const apply = flags.includes("--apply");
if (apply && !flags.includes(confirm)) throw new Error("Missing target confirmation");
let sha, deployment;
for (let i=0;i<flags.length;i++) {
  if (["--apply",confirm].includes(flags[i])) continue;
  if (flags[i]==="--sha" && /^[0-9a-f]{40}$/.test(flags[i+1]??"")) { sha=flags[++i]; continue; }
  if (flags[i]==="--deployment" && /^dpl_[A-Za-z0-9]+$/.test(flags[i+1]??"")) { deployment=flags[++i]; continue; }
  throw new Error("Unexpected D2 argument");
}
const checksums = Object.fromEntries(readdirSync("prisma/migrations", {withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>{
  const raw=readFileSync(resolve("prisma/migrations",d.name,"migration.sql"),"utf8");
  const lf=raw.replaceAll("\r\n","\n");
  // Prisma accepts equivalent LF/CRLF files; no SQL-content differences allowed.
  return [d.name,[raw,lf,lf.replaceAll("\n","\r\n")].map(s=>createHash("sha256").update(s).digest("hex"))];
}));
const db=new Client(pgConfig(process.env.DIRECT_URL));
const historical=target==="preview"?PREVIEW_HISTORICAL_MIGRATIONS:{};
async function history(){return (await db.query(`SELECT migration_name,checksum,finished_at IS NOT NULL applied,rolled_back_at IS NOT NULL rolled_back FROM _prisma_migrations ORDER BY started_at`)).rows;}
async function state(){
  const present=(await db.query(`SELECT to_regclass('public."ImageEmbeddingJob"') IS NOT NULL jobs,to_regclass('public."ImageEmbeddingRuntime"') IS NOT NULL runtime`)).rows[0];
  if(!present.jobs)return present;
  const jobs=(await db.query(`SELECT state,count(*)::int n FROM "ImageEmbeddingJob" GROUP BY state ORDER BY state`)).rows;
  const rls=(await db.query(`SELECT relname,relrowsecurity FROM pg_class WHERE oid IN ('public."ImageEmbeddingJob"'::regclass${present.runtime?',\'public."ImageEmbeddingRuntime"\'::regclass':''}) ORDER BY relname`)).rows;
  const runtime=present.runtime?(await db.query(`SELECT enabled,to_char(resume_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS resume_at_utc,(enabled AND resume_at <= (clock_timestamp() AT TIME ZONE 'UTC')) ready FROM "ImageEmbeddingRuntime" WHERE id=true`)).rows[0]:null;
  return {...present,counts:jobs,rls,execution:runtime};
}
try {
  await db.connect();await db.query("BEGIN READ ONLY");
  const pending=checkD2Migrations(checksums,await history(),historical);
  console.log(JSON.stringify({target,action,apply,pending,state:await state()}));
  await db.query("ROLLBACK");
  if(apply&&action==="migrate"&&pending.length){
    const r=spawnSync(process.execPath,["--import",new URL("../db/install-guard.mjs",import.meta.url).href,resolve("node_modules/prisma/build/index.js"),"migrate","deploy","--config",resolve("prisma7.config.ts")],{env:{...process.env,PGOPTIONS:"-c lock_timeout=5000 -c statement_timeout=60000"},encoding:"utf8",timeout:120000,maxBuffer:4*1024*1024});
    if(r.status!==0||r.error)throw new Error("D2 migration failed; CLI output suppressed; inspect history before retry");
  }
  if(apply&&["arm","pause"].includes(action)){
    if(pending.length)throw new Error("Finish approved migrations first");
    if(action==="arm"&&target==="production"){
      if(!sha||!deployment)throw new Error("Expected live D2 SHA and deployment required");
      const r=await fetch("https://mju-find.vercel.app/api/version",{cache:"no-store",signal:AbortSignal.timeout(15000),redirect:"error"});
      if(!r.ok)throw new Error("Live version unavailable");
      const v=await r.json();if(v.gitSha!==sha||v.deploymentId!==deployment||v.environment!=="production")throw new Error("Live D2 version differs");
    }
    await db.query("BEGIN");
    if(action==="pause")await db.query(`UPDATE "ImageEmbeddingRuntime" SET enabled=false,resume_at=NULL WHERE id=true`);
    else await db.query(`UPDATE "ImageEmbeddingRuntime" SET enabled=true,resume_at=(clock_timestamp() AT TIME ZONE 'UTC')+$1*interval '1 second' WHERE id=true AND NOT enabled`,[target==="production"?LEGACY_DRAIN_SECONDS:0]);
    await db.query("COMMIT");
  }
  await db.query("BEGIN READ ONLY");
  const after=checkD2Migrations(checksums,await history(),historical);
  if(apply&&action==="migrate"&&after.length)throw new Error("D2 migration incomplete");
  console.log(JSON.stringify({target,action,remaining:after,state:await state()}));
  await db.query("ROLLBACK");
}catch(error){await db.query("ROLLBACK").catch(()=>{});console.error("D2 operation stopped:",error.code??error.message);process.exitCode=1;}
finally{await db.end();}
