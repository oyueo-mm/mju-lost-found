// Next worker subprocesses cannot inherit Node's --env-file in NODE_OPTIONS.
// Load the fixed Preview files into the environment before spawning plain Node.
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {parse} from "dotenv";
import {assertDatabaseEnvironment,assertScriptSupabaseAccess} from "../../src/lib/db/accessPolicy.mjs";
if(process.argv.length!==3||process.argv[2]!=="--confirm-preview")throw new Error("Preview confirmation required");
const env={...process.env,...parse(readFileSync(".vercel/regression-preview.env")),...parse(readFileSync(".env.preview.local"))};
if(env.VERCEL_ENV==="production"||assertDatabaseEnvironment(env,{usage:"operation"})!=="preview"||assertScriptSupabaseAccess(env)!=="preview")throw new Error("Preview build environment required");
const publicKey=env.NEXT_PUBLIC_SUPABASE_ANON_KEY??env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if(!publicKey||publicKey==="[SENSITIVE]")throw new Error("Preview public client key required at build time");
delete env.MJU_REALTIME_PRIVATE_JWK;
const child=spawnSync(process.execPath,["node_modules/next/dist/bin/next","build"],{env,stdio:"inherit",windowsHide:true});
if(child.error)throw new Error("Preview build process unavailable");
process.exitCode=child.status??1;
