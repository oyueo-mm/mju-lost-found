// Aggregate-only, read-only evidence. Never invokes a cron or changes jobs.
import "../db/install-guard.mjs";
import {Client} from "pg";
import {assertDatabaseEnvironment} from "../../src/lib/db/accessPolicy.mjs";
import { pgConfig } from "../db/pgConfig.mjs";
const [day]=process.argv.slice(2);
if(process.argv.length!==3||!/^\d{4}-\d{2}-\d{2}$/.test(day??""))throw new Error("Explicit KST date required");
const start=new Date(`${day}T00:00:00+09:00`),end=new Date(start.getTime()+86400000);
if(!Number.isFinite(start.getTime()))throw new Error("Invalid date");
const target=assertDatabaseEnvironment(process.env,{usage:"operation"});
const db=new Client(pgConfig(process.env.DIRECT_URL, { connectionTimeoutMillis:15000 }));
try{
  await db.connect();await db.query("BEGIN READ ONLY");
  // Existing normalizeRoute() drops this long/hyphenated mode, so posts
  // metrics cannot prove a specific maintenance cron's success or absence.
  const observations=(await db.query(`SELECT to_char(hour,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS hour_utc,route,count,errors FROM "ApiMetricHourly" WHERE hour >= $1::timestamptz AT TIME ZONE 'UTC' AND hour < $2::timestamptz AT TIME ZONE 'UTC' AND route IN ('GET /api/posts','GET /api/admin/settings') ORDER BY hour,route`,[start.toISOString(),end.toISOString()])).rows;
  const jobs=(await db.query(`SELECT state,count(*)::int n FROM "ImageEmbeddingJob" GROUP BY state ORDER BY state`)).rows;
  await db.query("ROLLBACK");console.log(JSON.stringify({target,kstDay:day,readOnly:true,observations,jobs,maintenanceRouteAggregated:true,callerIdentityVerified:false}));
}catch(error){await db.query("ROLLBACK").catch(()=>{});console.error("Scheduled status read failed:",error.code??error.name);process.exitCode=1;}
finally{await db.end();}
