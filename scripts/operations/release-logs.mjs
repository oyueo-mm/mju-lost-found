// Output counts only: runtime log bodies may contain personal data.
import {spawnSync} from "node:child_process";
const id=process.argv[2];if(!/^dpl_[A-Za-z0-9]+$/.test(id??""))throw new Error("Explicit deployment required");
const results=[];
for(const [name,filter] of [["errors","--level error"],["5xx","--status-code 5xx"]]){
  const r=spawnSync(`npx --no-install vercel logs ${id} --since 20m ${filter} --json --limit 200`,{shell:true,encoding:"utf8",windowsHide:true,maxBuffer:8*1024*1024});
  if(r.status)throw new Error("Log query failed");
  const rows=r.stdout.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
  results.push({name,records:rows.length,window:"20m",limit:200});
}
console.log(JSON.stringify({deployment:id,results}));if(results.some(r=>r.records))process.exitCode=1;
