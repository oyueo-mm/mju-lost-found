// Only a new Production standby key and server-only variable are in scope.
// The Supabase import occurs in the operator's dashboard. This tool uses JWKS.
import {existsSync,readFileSync,writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {calculateJwkThumbprint,importJWK,jwtVerify,SignJWT} from "jose";
import {PREVIEW_DB_PROJECT,PRODUCTION_DB_PROJECT} from "../../src/lib/db/accessPolicy.mjs";
import {PROJECT_ID} from "../../src/lib/devstats/vercelDeployment.mjs";

const [action,confirmation,standbyConfirmation,...extra]=process.argv.slice(2);
if(!["baseline","verify","register-vercel"].includes(action)||confirmation!=="--confirm-production-key-only"||extra.length||
  (action==="register-vercel"?standbyConfirmation!=="--confirm-standby":standbyConfirmation!==undefined)){
  throw new Error("Production key-only operation confirmation required");
}
const baseline=new URL("../../.vercel/realtime-production-key-baseline.json",import.meta.url);
const receipt=new URL("../../.vercel/realtime-production-key-vercel.json",import.meta.url);
const checkpoint=new URL("../../.vercel/realtime-production-manual.dpapi",import.meta.url);
const repoRoot=fileURLToPath(new URL("../../",import.meta.url));

class OperationStopped extends Error {}
const requireCheck=(condition,message)=>{if(!condition)throw new OperationStopped(message);};

function readLocalKey(){
  requireCheck(process.platform==="win32","Windows CurrentUser key checkpoint required");
  const command="$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$cipher=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());$entropy=[Text.Encoding]::UTF8.GetBytes('MJU Find Production Realtime manual v1');$plain=[Security.Cryptography.ProtectedData]::Unprotect($cipher,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Convert]::ToBase64String($plain)";
  const child=spawnSync("powershell.exe",["-NoProfile","-Command",command],{
    input:readFileSync(checkpoint,"utf8"),encoding:"utf8",windowsHide:true,timeout:15000,maxBuffer:16384,
  });
  requireCheck(child.status===0&&!child.error,"Production key checkpoint could not be opened");
  const {version,project,key}=JSON.parse(Buffer.from(child.stdout.trim(),"base64").toString("utf8"));
  requireCheck(version===1&&project===PRODUCTION_DB_PROJECT&&key?.alg==="ES256"&&key.kty==="EC"&&key.crv==="P-256"&&
    /^[0-9a-f-]{36}$/.test(key.kid)&&[key.d,key.x,key.y].every(value=>typeof value==="string"&&/^[A-Za-z0-9_-]{43}$/.test(value)),"Production key checkpoint is invalid");
  return key;
}

async function publicKeys(project){
  const response=await fetch(`https://${project}.supabase.co/auth/v1/.well-known/jwks.json`,{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15000)});
  requireCheck(response.ok,"Public JWKS is unavailable");
  const {keys}=await response.json();
  requireCheck(Array.isArray(keys)&&keys.length>0&&new Set(keys.map(key=>key.kid)).size===keys.length,"Unexpected public JWKS");
  return Promise.all(keys.map(async key=>({kid:key.kid,alg:key.alg,thumbprint:await calculateJwkThumbprint(key)})));
}

function validateVercel(){
  const link=JSON.parse(readFileSync(new URL("../../.vercel/project.json",import.meta.url),"utf8"));
  requireCheck(link.projectId===PROJECT_ID&&/^team_[A-Za-z0-9]+$/.test(link.orgId),"Linked Vercel project differs from MJU Find");
  return link;
}

function vercel(link,command,input){
  const result=spawnSync(`npx --no-install vercel ${command} --scope ${link.orgId}`,{cwd:repoRoot,shell:true,input,encoding:"utf8",windowsHide:true,timeout:60000,maxBuffer:2*1024*1024});
  requireCheck(result.status===0&&!result.error,"Vercel operation unavailable; sensitive diagnostics suppressed");
  return result.stdout;
}

try{
  const key=readLocalKey();
  const {d,...publicJwk}=key;
  requireCheck(d?.length===43,"Missing local signing value");
  const localTest=await new SignJWT({purpose:"local-key-check"}).setProtectedHeader({alg:"ES256"}).sign(await importJWK(key,"ES256"));
  await jwtVerify(localTest,await importJWK(publicJwk,"ES256"),{algorithms:["ES256"]});
  const local={kid:key.kid,alg:key.alg,thumbprint:await calculateJwkThumbprint(publicJwk)};
  const [production,preview]=await Promise.all([publicKeys(PRODUCTION_DB_PROJECT),publicKeys(PREVIEW_DB_PROJECT)]);
  const same=(a,b)=>a.kid===b.kid&&a.alg===b.alg&&a.thumbprint===b.thumbprint;
  const distinct=items=>items.every(item=>item.kid!==local.kid&&item.thumbprint!==local.thumbprint);
  requireCheck(distinct(preview),"The local Production key overlaps Preview");

  if(action==="baseline"){
    requireCheck(distinct(production),"Local key already overlaps Production; preserve the existing baseline");
    if(existsSync(baseline)){
      const saved=JSON.parse(readFileSync(baseline,"utf8"));
      requireCheck(same(saved.planned,local)&&saved.before.length===production.length&&saved.before.every(old=>production.some(current=>same(old,current))),"Existing baseline differs; no overwrite");
    }else{
      writeFileSync(baseline,JSON.stringify({project:PRODUCTION_DB_PROJECT,planned:local,before:production,capturedAt:new Date().toISOString()}),{flag:"wx"});
    }
    const link=validateVercel();
    const variableExists=/\bMJU_REALTIME_PRIVATE_JWK\b/.test(vercel(link,"env ls production"));
    requireCheck(!variableExists,"Production variable already exists; no overwrite");
    console.log(JSON.stringify({project:PRODUCTION_DB_PROJECT,publicKid:key.kid,existingPublicKeys:production.length,localSignVerify:true,previewKeyDistinct:true,productionKeyPublished:false,productionVariableExists:false}));
  }else{
    const saved=JSON.parse(readFileSync(baseline,"utf8"));
    requireCheck(saved.project===PRODUCTION_DB_PROJECT&&same(saved.planned,local),"The pre-import baseline does not match the checkpoint");
    requireCheck(production.some(item=>same(item,local)),"Local key not yet published or does not match Production JWKS");
    requireCheck(production.length===saved.before.length+1&&saved.before.every(old=>production.some(current=>same(old,current))),"Existing published keys differ from the baseline");
    if(action==="register-vercel"){
      const link=validateVercel();
      const variableExists=/\bMJU_REALTIME_PRIVATE_JWK\b/.test(vercel(link,"env ls production"));
      const prior=existsSync(receipt)?JSON.parse(readFileSync(receipt,"utf8")):null;
      requireCheck(!prior||(prior.publicKid===local.kid&&prior.projectId===link.projectId&&prior.target==="production"&&variableExists),"Existing Vercel receipt differs");
      requireCheck(!variableExists||prior,"Production variable already exists; no overwrite");
      if(!variableExists){
        vercel(link,"env add MJU_REALTIME_PRIVATE_JWK production --sensitive --yes",JSON.stringify(key)+"\n");
        requireCheck(/\bMJU_REALTIME_PRIVATE_JWK\b/.test(vercel(link,"env ls production")),"Production variable creation was not confirmed");
        writeFileSync(receipt,JSON.stringify({target:"production",projectId:link.projectId,publicKid:local.kid,recordedAt:new Date().toISOString()}),{flag:"wx"});
      }
    }
    console.log(JSON.stringify({project:PRODUCTION_DB_PROJECT,publicKid:key.kid,publishedKeyMatches:true,existingPublishedKeysUnchanged:true,previewKeyDistinct:true,productionSensitiveVariableRegistered:action==="register-vercel"}));
  }
}catch(error){
  console.error(error instanceof OperationStopped?error.message:"Production key verification stopped; sensitive diagnostics suppressed");
  process.exitCode=1;
}
