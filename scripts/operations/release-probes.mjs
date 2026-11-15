// Public, non-destructive probes. No login cookies or mutation endpoints.
// Image POST performs search only; no Storage object or post is created.
import {spawnSync} from "node:child_process";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {createHash} from "node:crypto";
import {POST_IMAGE_REMOTE_PATTERNS} from "../../src/lib/images/optimizationHosts.mjs";
const [target,expectedSha,expectedDeployment]=process.argv.slice(2);
if(!["production","preview"].includes(target)||!/^([a-f0-9]{40})$/.test(expectedSha??"")||!/^dpl_[A-Za-z0-9]+$/.test(expectedDeployment??""))throw new Error("Usage: release-probes.mjs production|preview <SHA> <deployment>");
const base=target==="production"?"https://mju-find.vercel.app":"https://mju-lost-found-preview.vercel.app";
const results=[];
const check=(name,passed,details={})=>{results.push({name,passed,...details});if(!passed)throw new Error(`Probe failed: ${name}`);};
async function request(path,image=false){
  const start=performance.now();let status,text;
  if(target==="production"){
    const form=image?new FormData():null;if(form)form.set("image",new Blob([readFileSync("docs/ai-eval-seed/query-images/R12.jpg")],{type:"image/jpeg"}),"query.jpg");
    const r=await fetch(base+path,{method:image?"POST":"GET",body:form,redirect:"manual",signal:AbortSignal.timeout(90000)});status=r.status;text=await r.text();
  }else{
    // path is constructed only from the fixed checks below and encoded DB URLs.
    if(/["\r\n`$]/.test(path))throw new Error("Unexpected probe path");
    const command=`npx --no-install vercel curl "${path}" --deployment ${base} -- --silent --show-error --max-time 90 --write-out "\\nPROBE_STATUS %{http_code}"${image?' --form "image=@docs/ai-eval-seed/query-images/R12.jpg;type=image/jpeg"':''}`;
    const r=spawnSync(command,{shell:true,encoding:"utf8",windowsHide:true,maxBuffer:4*1024*1024});if(r.status)throw new Error("Preview probe transport failed");
    const match=/\sPROBE_STATUS (\d{3})\s*$/.exec(r.stdout);if(!match)throw new Error("Probe status missing");status=Number(match[1]);text=r.stdout.slice(0,match.index);
  }
  let json;try{json=JSON.parse(text);}catch{}
  return {status,json,ms:Math.round(performance.now()-start)};
}
try{
  const version=await request("/api/version");check("version",version.status===200&&version.json?.gitSha===expectedSha&&version.json?.deploymentId===expectedDeployment,{version:version.json});
  for(const path of ["/","/login","/api/auth/session","/policy/privacy"]){const r=await request(path);check(`public ${path}`,r.status===200,{status:r.status});}
  for(const path of ["/api/chat","/api/admin/reports","/api/admin/reports/1/evidence/0","/api/posts?mode=embedding-maintenance"]){const r=await request(path);check(`authentication ${path}`,[401,403].includes(r.status),{status:r.status});}
  for(const mode of ["keyword","semantic","unified","image"]){
    const r=await request(`/api/posts?type=found&mode=${mode}&limit=5${mode==="image"?"":`&q=${encodeURIComponent("검은 지갑")}`}`,mode==="image");
    const rows=r.json?.data;check(`search ${mode}`,r.status===200&&Array.isArray(rows),{status:r.status,ms:r.ms,count:rows?.length,rankHash:Array.isArray(rows)?createHash("sha256").update(JSON.stringify(rows.map(p=>({id:p.id,type:p.type??p.postType,score:p.score??p.aiSimilarity??p.similarity??null})))).digest("hex"):null});
  }
  const listing=await request("/api/posts?type=found&limit=10");const photo=listing.json?.data?.find(p=>p.imageUrl)?.imageUrl;
  check("existing photo available",typeof photo==="string");
  const photoUrl=new URL(photo);check("existing photo origin",photoUrl.protocol==="https:"&&POST_IMAGE_REMOTE_PATTERNS.some(p=>p.hostname===photoUrl.hostname));
  const r=target==="production"?await fetch(`${base}/_next/image?${new URLSearchParams({url:photo,w:"128",q:"75"})}`,{signal:AbortSignal.timeout(60000)}):await fetch(photo,{signal:AbortSignal.timeout(60000)});
  const bytes=(await r.arrayBuffer()).byteLength;check("existing photo display",r.ok&&r.headers.get("content-type")?.startsWith("image/")&&bytes>0,{status:r.status,bytes});
}catch(error){console.error(error.message);process.exitCode=1;}
finally{mkdirSync(".vercel",{recursive:true});writeFileSync(`.vercel/release-probes-${target}-${Date.now()}.json`,JSON.stringify({target,results},null,2));console.log(JSON.stringify({target,results}));}
