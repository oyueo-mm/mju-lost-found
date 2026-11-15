// Local Next trace model bytes, not the deployed compressed function size.
import {readFileSync,statSync} from "node:fs";
import {resolve,dirname} from "node:path";
const routes=["api/posts","api/posts/[id]","api/posts/[id]/image","api/posts/[id]/comments"];
const result=routes.map(route=>{
  const file=resolve(".next/server/app",route,"route.js.nft.json"),trace=JSON.parse(readFileSync(file,"utf8"));
  const modelFiles=trace.files.map(f=>resolve(dirname(file),f)).filter(f=>/[\\/]models[\\/]/.test(f));
  return {route,modelFiles:modelFiles.length,modelBytes:modelFiles.reduce((n,f)=>n+statSync(f).size,0),hasTextModel:modelFiles.some(f=>/[\\/]jhgan[\\/]/.test(f))};
});console.log(JSON.stringify({localTraceOnly:true,result}));
const image=result.find(r=>r.route.endsWith("/image"));if(image.hasTextModel||image.modelFiles!==3)process.exitCode=1;
