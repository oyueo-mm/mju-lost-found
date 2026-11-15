// Inspect deployment source names only; never download file contents.
import {spawnSync} from "node:child_process";
const id=process.argv[2];if(!/^dpl_[A-Za-z0-9]+$/.test(id??""))throw new Error("Explicit deployment ID required");
const r=spawnSync(`npx --no-install vercel api "/v6/deployments/${id}/files"`,{shell:true,encoding:"utf8",windowsHide:true,maxBuffer:32*1024*1024});if(r.status)throw new Error("Deployment upload metadata unavailable");
const tree=JSON.parse(r.stdout),root=tree.find(n=>n.name==="src"&&n.type==="directory");if(!root?.children)throw new Error("Repository source root missing");
const paths=[];function walk(nodes,base=""){for(const n of nodes){const path=base+n.name;if(n.type==="file")paths.push(path);if(n.children)walk(n.children,path+"/");}}walk(root.children);
const disallowed=paths.filter(p=>/(^|\/)(\.vercel|\.next|\.claude|\.codex|\.aws|\.agents)(\/|$)/.test(p)||p.startsWith("scripts/fixtures/")||(/(^|\/)\.env(?:\.|$)/.test(p)&&p!==".env.example")||/\.env(?:\.|$)/.test(p)&&p!==".env.example");
const required=["src/app/api/version/route.ts","src/lib/ai/imageJob.ts","scripts/db/approved-operation.mjs"].every(p=>paths.includes(p));
console.log(JSON.stringify({deployment:id,files:paths.length,disallowedCount:disallowed.length,requiredSourcePresent:required}));
if(disallowed.length||!required)process.exitCode=1;
