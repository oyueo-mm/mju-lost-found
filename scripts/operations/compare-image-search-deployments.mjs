// Four normal, non-persistent image searches. No load or rate-limit test.
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {writeFileSync,mkdirSync} from "node:fs";
const ids=process.argv.slice(2);if(ids.length!==2||ids.some(id=>!/^dpl_[A-Za-z0-9]+$/.test(id)))throw new Error("Two explicit deployments required");
function command(text){const r=spawnSync(text,{shell:true,encoding:"utf8",windowsHide:true,maxBuffer:8*1024*1024});if(r.status)throw new Error("Comparison request failed");return r.stdout;}
const deployments=ids.map(id=>{const d=JSON.parse(command(`npx --no-install vercel api "/v13/deployments/${id}"`));if(d.readyState!=="READY"||!/^mju-lost-found-vercel-[a-z0-9]{9}-oyueo\.vercel\.app$/.test(d.url))throw new Error("Unexpected comparison deployment");return {id,url:d.url};});
const results=[];
for(let round=1;round<=2;round++)for(const d of deployments){
  const out=command(`npx --no-install vercel curl "/api/posts?type=found&mode=image&limit=5" --deployment https://${d.url} -- --silent --show-error --max-time 90 --write-out "\\nIMAGE_TIME %{http_code} %{time_total}" --form "image=@docs/ai-eval-seed/query-images/R12.jpg;type=image/jpeg"`);
  const match=/\sIMAGE_TIME (\d{3}) ([\d.]+)\s*$/.exec(out);if(!match)throw new Error("Missing timing");
  const rows=JSON.parse(out.slice(0,match.index)).data;
  if(Number(match[1])!==200||!Array.isArray(rows))throw new Error("Search comparison failed");
  results.push({deployment:d.id,round,status:200,ms:Math.round(Number(match[2])*1000),rankHash:createHash("sha256").update(JSON.stringify(rows.map(p=>({id:p.id,type:p.type??p.postType,score:p.score??p.aiSimilarity??p.similarity??null})))).digest("hex")});
}
mkdirSync(".vercel",{recursive:true});writeFileSync(`.vercel/image-search-comparison-${Date.now()}.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
if(new Set(results.map(r=>r.rankHash)).size!==1)process.exitCode=1;
