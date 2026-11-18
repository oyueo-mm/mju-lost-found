// Fixed Preview checkpoint only. Never log, persist plaintext, or return a token.
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {assertDatabaseEnvironment,assertScriptSupabaseAccess,PREVIEW_DB_PROJECT} from "../../src/lib/db/accessPolicy.mjs";

export async function loadApprovedPreviewRealtimeKey(env=process.env){
  if(process.platform!=="win32"||env.VERCEL_ENV==="production"||assertDatabaseEnvironment(env,{usage:"operation"})!=="preview"||assertScriptSupabaseAccess(env)!=="preview")throw new Error("Preview-only Windows checkpoint required");
  const encrypted=readFileSync(new URL("../../.vercel/realtime-preview-manual.dpapi",import.meta.url),"utf8");
  const command="$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$cipher=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());$entropy=[Text.Encoding]::UTF8.GetBytes('MJU Find Preview Realtime manual v1');$plain=[Security.Cryptography.ProtectedData]::Unprotect($cipher,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Convert]::ToBase64String($plain)";
  const child=spawnSync("powershell.exe",["-NoProfile","-Command",command],{input:encrypted,encoding:"utf8",windowsHide:true,timeout:15000,maxBuffer:16384});
  if(child.status!==0||child.error)throw new Error("Preview checkpoint decrypt failed; diagnostics suppressed");
  let state;
  try{state=JSON.parse(Buffer.from(child.stdout.trim(),"base64").toString("utf8"));}catch{throw new Error("Invalid Preview checkpoint");}
  const key=state.key;
  if(state.version!==1||state.project!==PREVIEW_DB_PROJECT||key?.kid!=="c0eb51e4-97b9-4d13-b042-1a820650d257"||key.kty!=="EC"||key.crv!=="P-256"||key.alg!=="ES256"||[key.d,key.x,key.y].some(v=>typeof v!=="string"||!/^[-_A-Za-z0-9]{43}$/.test(v)))throw new Error("Approved Preview key differs");
  const r=await fetch(`https://${PREVIEW_DB_PROJECT}.supabase.co/auth/v1/.well-known/jwks.json`,{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error("Preview public key publication unavailable");
  const matches=(await r.json()).keys?.filter(k=>k.kid===key.kid&&k.kty===key.kty&&k.alg===key.alg&&k.crv===key.crv&&k.x===key.x&&k.y===key.y);
  if(matches?.length!==1)throw new Error("Preview published key does not match the checkpoint");
  if(env.MJU_REALTIME_PRIVATE_JWK&&env.MJU_REALTIME_PRIVATE_JWK!=="[SENSITIVE]"){
    let existing;try{existing=JSON.parse(env.MJU_REALTIME_PRIVATE_JWK);}catch{throw new Error("Existing signing configuration is invalid; diagnostics suppressed");}
    if(JSON.stringify(existing)!==JSON.stringify(key))throw new Error("Existing signing configuration must be reviewed; overwrite refused");
  }
  return key;
}
