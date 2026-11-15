// Local Next trace model bytes, not the deployed compressed function size.
import {readFileSync,statSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {spawnSync} from "node:child_process";
const routes=["api/posts","api/posts/[id]","api/posts/[id]/image","api/posts/[id]/comments"];
const result=routes.map(route=>{
  const file=resolve(".next/server/app",route,"route.js.nft.json"),trace=JSON.parse(readFileSync(file,"utf8"));
  const modelFiles=trace.files.map(f=>resolve(dirname(file),f)).filter(f=>/[\\/]models[\\/]/.test(f));
  return {route,modelFiles:modelFiles.length,modelBytes:modelFiles.reduce((n,f)=>n+statSync(f).size,0),hasTextModel:modelFiles.some(f=>/[\\/]jhgan[\\/]/.test(f))};
});console.log(JSON.stringify({localTraceOnly:true,result}));
const image=result.find(r=>r.route.endsWith("/image"));if(image.hasTextModel||image.modelFiles!==3)process.exitCode=1;
for(const id of process.argv.slice(2)){
  if(!/^dpl_[A-Za-z0-9]+$/.test(id))throw new Error("Invalid deployment ID");
  const r=spawnSync(`npx --no-install vercel api "/v13/deployments/${id}"`,{shell:true,encoding:"utf8",windowsHide:true,maxBuffer:32*1024*1024});if(r.status)throw new Error("Function metadata unavailable");
  const d=JSON.parse(r.stdout),outputs=(d.lambdas??[]).flatMap(l=>l.output??[]);
  console.log(JSON.stringify({deployment:id,state:d.readyState,artifactReferences:outputs.length,uniqueArtifactPaths:new Set(outputs.map(o=>o.path)).size,reportedSizesAvailable:outputs.length>0&&outputs.every(o=>typeof o.size==="number")}));
}
