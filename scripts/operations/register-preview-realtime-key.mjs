// Preview only. Standby import + sensitive Vercel variable; never rotate,
// activate, revoke, delete keys or change providers. No secrets on stdout.
import {generateKeyPair,exportJWK} from "jose";
import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync} from "node:fs";
import {resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {PREVIEW_DB_PROJECT} from "../../src/lib/db/accessPolicy.mjs";
class RegistrationStopped extends Error {}
const args=process.argv.slice(2);
if(args.some(a=>!["--apply","--confirm-preview-only"].includes(a)))throw new RegistrationStopped("Only Preview key registration is supported");
const apply=args.includes("--apply");
if(apply&&!args.includes("--confirm-preview-only"))throw new RegistrationStopped("Explicit Preview-only confirmation required");
const checkpoint=resolve(".vercel/realtime-preview-registration.dpapi");
const token=process.env.SUPABASE_ACCESS_TOKEN;
console.log(JSON.stringify({target:"preview",project:PREVIEW_DB_PROJECT,apply,existingCheckpoint:existsSync(checkpoint),managementAuthenticated:!!token,policy:"standby import only; no existing key changes"}));
if(!apply)process.exit(0);
if(!token)throw new RegistrationStopped("Authenticated Supabase management connection required; no key generated");
if(process.platform!=="win32")throw new RegistrationStopped("This registration checkpoint uses Windows CurrentUser DPAPI");
const entropy=Buffer.from("MJU Find Preview Realtime registration v1").toString("base64");
function dpapi(value,protect){
  const expression=protect
    ? `[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Convert]::FromBase64String($inputValue),[Convert]::FromBase64String('${entropy}'),[Security.Cryptography.DataProtectionScope]::CurrentUser))`
    : `[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($inputValue),[Convert]::FromBase64String('${entropy}'),[Security.Cryptography.DataProtectionScope]::CurrentUser))`;
  const r=spawnSync("powershell.exe",["-NoProfile","-Command",`$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$inputValue=[Console]::In.ReadToEnd().Trim();${expression}`],{input:value,encoding:"utf8",windowsHide:true,timeout:15000});
  if(r.status!==0||r.error)throw new RegistrationStopped("Encrypted checkpoint operation failed; diagnostics suppressed");
  return r.stdout.trim();
}
function save(state){mkdirSync(".vercel",{recursive:true});const data=dpapi(Buffer.from(JSON.stringify(state)).toString("base64"),true);writeFileSync(checkpoint+".new",data);renameSync(checkpoint+".new",checkpoint);}
async function management(method,body){
  const r=await fetch(`https://api.supabase.com/v1/projects/${PREVIEW_DB_PROJECT}/config/auth/signing-keys`,{method,headers:{Authorization:`Bearer ${token}`,"content-type":"application/json"},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000),redirect:"error"});
  if(!r.ok){await r.body?.cancel();throw new RegistrationStopped(`Preview key management returned HTTP ${r.status}; no activation attempted`);}return r.json();
}
function vercel(command,input){
  // The command is constant; secret values are provided exclusively on stdin.
  const r=spawnSync(`npx --no-install vercel ${command}`,{shell:true,input,encoding:"utf8",windowsHide:true,timeout:60000,maxBuffer:2*1024*1024});
  if(r.status!==0||r.error)throw new RegistrationStopped("Sensitive Preview environment operation failed; diagnostics suppressed");return r.stdout;
}
try{
  let state=existsSync(checkpoint)?JSON.parse(Buffer.from(dpapi(readFileSync(checkpoint,"utf8"),false),"base64").toString("utf8")):null;
  if(state&&state.project!==PREVIEW_DB_PROJECT)throw new RegistrationStopped("Checkpoint project differs");
  const before=await management("GET");if(!Array.isArray(before))throw new RegistrationStopped("Unexpected signing-key metadata shape");
  if(!state){
    if(vercel("env ls preview").includes("MJU_REALTIME_PRIVATE_JWK"))throw new RegistrationStopped("Existing Preview signing variable must be reviewed; overwrite refused");
    const pair=await generateKeyPair("ES256",{extractable:true});
    state={project:PREVIEW_DB_PROJECT,key:{...await exportJWK(pair.privateKey),alg:"ES256"},submitted:false,existing:before.map(k=>({id:k.id,status:k.status})),envAdded:false};save(state);
  }
  const matches=before.filter(k=>k.public_jwk?.x===state.key.x&&k.public_jwk?.y===state.key.y);
  let registered=matches[0];if(matches.length>1)throw new RegistrationStopped("Duplicate imported public key; review required");
  if(!registered){
    if(state.submitted)throw new RegistrationStopped("Previous key submission has no visible matching key; duplicate creation refused");
    state.submitted=true;save(state); // Save before the network mutation.
    registered=await management("POST",{algorithm:"ES256",status:"standby",private_jwk:state.key});
  }
  if(registered.status!=="standby"||registered.algorithm!=="ES256"||!registered.public_jwk||registered.public_jwk.x!==state.key.x||registered.public_jwk.y!==state.key.y)throw new RegistrationStopped("Imported standby key differs; no activation or secret registration attempted");
  const after=await management("GET");
  if(state.existing.some(k=>!after.some(a=>a.id===k.id&&a.status===k.status)))throw new RegistrationStopped("Existing signing-key state changed; stop and review");
  const kid=registered.public_jwk.kid??registered.id;
  if(!/^[0-9a-f-]{36}$/i.test(kid))throw new RegistrationStopped("Unexpected public key ID");
  state.key.kid=kid;state.registrationId=registered.id;save(state);
  if(!state.envAdded){
    if(vercel("env ls preview").includes("MJU_REALTIME_PRIVATE_JWK"))throw new RegistrationStopped("Preview variable already exists; overwrite refused");
    vercel("env add MJU_REALTIME_PRIVATE_JWK preview --sensitive --yes",JSON.stringify(state.key)+"\n");
    state.envAdded=true;save(state);
  }
  console.log(JSON.stringify({target:"preview",kid,status:"standby",sensitiveEnvironmentAdded:state.envAdded,existingKeysUnchanged:true,privateRealtimeVerified:false}));
}catch(error){console.error(error instanceof RegistrationStopped?error.message:"Preview key registration stopped; sensitive diagnostics suppressed");process.exitCode=1;}
