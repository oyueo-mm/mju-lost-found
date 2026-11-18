// Uses an already-imported manual Standby key. No Supabase management writes.
import {spawnSync} from "node:child_process";
import {readFileSync,writeFileSync,existsSync} from "node:fs";
import {loadApprovedPreviewRealtimeKey} from "./preview-realtime-manual-state.mjs";
const args=process.argv.slice(2);
if(args.some(a=>!["--apply","--confirm-preview"].includes(a))||!args.includes("--confirm-preview"))throw new Error("Preview-only confirmation required");
const apply=args.includes("--apply");
try{
  const key=await loadApprovedPreviewRealtimeKey();
  const project=JSON.parse(readFileSync(new URL("../../.vercel/project.json",import.meta.url),"utf8"));
  if(!/^team_[A-Za-z0-9]+$/.test(project.orgId)||!/^prj_[A-Za-z0-9]+$/.test(project.projectId))throw new Error("Validated linked Vercel project required");
  const checkpoint=new URL("../../.vercel/realtime-preview-manual-environment.json",import.meta.url);
  function vercel(command,input){
    const r=spawnSync(`npx --no-install vercel ${command} --scope ${project.orgId}`,{shell:true,input,encoding:"utf8",windowsHide:true,timeout:60000,maxBuffer:2*1024*1024});
    if(r.status!==0||r.error)throw new Error("Preview environment operation failed; diagnostics suppressed");
    return r.stdout;
  }
  const present=vercel("env ls preview").includes("MJU_REALTIME_PRIVATE_JWK");
  const saved=existsSync(checkpoint)?JSON.parse(readFileSync(checkpoint,"utf8")):null;
  if(present&&(!saved||saved.kid!==key.kid||saved.projectId!==project.projectId||saved.target!=="preview"))throw new Error("Existing Preview variable has no matching registration record; overwrite refused");
  if(saved&&!present)throw new Error("Recorded Preview variable is absent; review before registration");
  if(apply&&!present){
    vercel("env add MJU_REALTIME_PRIVATE_JWK preview --sensitive --yes",JSON.stringify(key)+"\n");
    writeFileSync(checkpoint,JSON.stringify({target:"preview",projectId:project.projectId,kid:key.kid,addedAt:new Date().toISOString()}),{flag:"wx"});
  }
  console.log(JSON.stringify({target:"preview",kid:key.kid,apply,existing:present,sensitiveEnvironmentAdded:apply&&!present,alreadyRegistered:present,productionChanged:false,supabaseKeyChanges:false}));
}catch(error){
  const safe=new Set(["Validated linked Vercel project required","Preview environment operation failed; diagnostics suppressed","Existing Preview variable has no matching registration record; overwrite refused"]);
  console.error(safe.has(error.message)?error.message:"Preview environment registration stopped; sensitive diagnostics suppressed");process.exitCode=1;
}
