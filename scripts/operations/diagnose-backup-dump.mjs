// Read-only Production diagnostic through approved-operation.mjs only.
// Schema output goes to the null device. No backup is marked successful.
import "../db/install-guard.mjs";
import {Client} from "pg";
import {execFile} from "node:child_process";
import {join} from "node:path";
import {withBackupSnapshot} from "../backup/snapshot.mjs";
import {assertDatabaseEnvironment} from "../../src/lib/db/accessPolicy.mjs";
import { pgConfig, libpqTlsEnv } from "../db/pgConfig.mjs";
const target=assertDatabaseEnvironment(process.env,{usage:"operation"});
if(!["production","preview"].includes(target))throw new Error("Hosted backup diagnostic required");
const url=process.env.DIRECT_URL,db=new Client(pgConfig(url, { connectionTimeoutMillis:15000 }));
const redact=s=>{
  let text=String(s??"").replace(/postgres(?:ql)?:\/\/[^\s"']+/gi,"[REDACTED_DB_URL]").replace(/https?:\/\/[^\s"']+/gi,"[URL]").replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,"[REDACTED_JWT]");
  // pg_dump's stderr normally has no password, but redact every known secret
  // defensively before showing even a bounded diagnostic excerpt.
  for(const [key,value]of Object.entries(process.env))if(value&&value.length>5&&/SECRET|TOKEN|PASSWORD|DIRECT_URL|DATABASE_URL|PRIVATE|SERVICE_ROLE/.test(key))text=text.replaceAll(value,"[REDACTED]");
  const password=new URL(url).password;if(password)for(const value of [password,decodeURIComponent(password)])text=text.replaceAll(value,"[REDACTED]");
  return text.slice(0,2500);
};
try{
  await db.connect();
  await withBackupSnapshot(db,async(snapshot,signal)=>{
    const version=(await db.query("SELECT current_setting('server_version') AS version")).rows[0].version;
    const result=await new Promise(resolve=>execFile(join(process.env.PG_BIN??"",process.platform==="win32"?"pg_dump.exe":"pg_dump"),[url,"--snapshot",snapshot,"--schema-only","--no-owner","--no-privileges","-f",process.platform==="win32"?"NUL":"/dev/null"],{signal,timeout:60000,maxBuffer:1024*1024,windowsHide:true,env:{...process.env,...libpqTlsEnv(url)}},(error,_stdout,stderr)=>resolve({code:error?.code??0,stderr:redact(stderr)})));
    console.log(JSON.stringify({target,diagnostic:"shared-snapshot schema-only pg_dump",serverVersion:version,...result}));
    if(result.code!==0)process.exitCode=1;
  });
}catch(error){console.error(JSON.stringify({target,diagnosticFailed:true,code:error.code??error.name,message:redact(error.message)}));process.exitCode=1;}
finally{await db.end();}
