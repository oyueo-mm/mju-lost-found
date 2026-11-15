// Preview-only independent-process integration. Provider is a local test double;
// deployed Preview search is validated separately with the real model.
import "../db/install-guard.mjs";
import { assertDatabaseEnvironment, PREVIEW_DB_PROJECT } from "../../src/lib/db/accessPolicy.mjs";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
if (assertDatabaseEnvironment(process.env, { usage: "operation" }) !== "preview") throw new Error("Preview only");
const jiti=createJiti(import.meta.url,{alias:{"@":fileURLToPath(new URL("../../src",import.meta.url))}});
const {prisma}=await jiti.import("../../src/lib/db/prisma.ts");
const [mode,rawId,log,delay="0",fail="0"]=process.argv.slice(2);
if(mode==="worker") {
  const {getImageEmbeddingProvider}=await jiti.import("../../src/lib/ai/imageEmbedding.ts");
  getImageEmbeddingProvider().embed=async url=>{
    appendFileSync(log,JSON.stringify({started:true})+"\n");
    await new Promise(r=>setTimeout(r,Number(delay)));
    if(fail==="1")throw new Error("SyntheticInferenceFailure");
    return Array.from({length:768},(_,i)=>i===(url.endsWith("b.jpg")?1:0)?1:0);
  };
  const {runImageJob,runLatestImageJob}=await jiti.import("../../src/lib/ai/imageJob.ts");
  try { const post=await prisma.lostPost.findUnique({where:{id:Number(rawId)},include:{user:true}}); if(!post?.user.email.endsWith("@image-jobs.example.invalid"))throw new Error("Not a fixture"); const r=delay!=="0"?await runLatestImageJob("lost",post.id):await runImageJob("lost",post.id,true); console.log(JSON.stringify(r??{status:"drained"})); }
  finally {await prisma.$disconnect();}
  process.exit(0);
}
const marker=randomUUID(), posts=[];let user;
mkdirSync(".vercel",{recursive:true});
const logFile=`.vercel/image-jobs-${marker}.jsonl`;writeFileSync(logFile,"");
const count=()=>readFileSync(logFile,"utf8").trim().split("\n").filter(Boolean).length;
const check=(name,ok)=>{console.log(JSON.stringify({check:name,passed:!!ok}));if(!ok)throw new Error(name);};
const photo=(id,name)=>`https://${PREVIEW_DB_PROJECT}.supabase.co/storage/v1/object/public/post-images/posts/lost/${id}/${name}.jpg`;
function worker(id,delay=0,fail=0) {return new Promise((resolve,reject)=>{const c=spawn(process.execPath,[fileURLToPath(import.meta.url),"worker",String(id),logFile,String(delay),String(fail)],{env:process.env,windowsHide:true});let out="";c.stdout.on("data",b=>out+=b);c.stderr.on("data",()=>{});c.on("error",()=>reject(new Error("Worker could not start")));c.on("close",code=>code?reject(new Error("Worker failed")):resolve(JSON.parse(out.trim().split("\n").at(-1))));});}
async function create() {const p=await prisma.lostPost.create({data:{userId:user.id,title:`Image job ${marker}`,description:"Synthetic fixture",category:"기타",location:"Synthetic fixture",lostDate:new Date()}});posts.push(p.id);await prisma.lostPost.update({where:{id:p.id},data:{imageUrl:photo(p.id,"a")}});return p.id;}
async function state(id) {return (await prisma.$queryRaw`SELECT p.image_url,p."imageEmbedding"::text AS vector,j.* FROM "LostPost" p JOIN "ImageEmbeddingJob" j ON j.post_type='lost' AND j.post_id=p.id WHERE p.id=${id}`)[0];}
async function waitStart(previous) {for(let i=0;i<200;i++){if(count()>previous)return;await new Promise(r=>setTimeout(r,50));}throw new Error("Worker did not infer");}
try {
  user=await prisma.user.create({data:{email:`${marker}@image-jobs.example.invalid`,name:"Synthetic image worker",nickname:"Synthetic fixture",isAdmin:true}});
  const first=await create(), before=count();
  const concurrent=await Promise.all(Array.from({length:4},()=>worker(first)));
  check("four processes infer exactly once",count()===before+1&&concurrent.some(r=>r.status==="completed"));
  check("identical input reused",(await worker(first)).status==="reused"&&count()===before+1);
  await prisma.$executeRaw`UPDATE "ImageEmbeddingJob" SET state='running',lease_token='simulated-crash',lease_until=(now() AT TIME ZONE 'UTC')-interval '1 second' WHERE post_type='lost' AND post_id=${first}`;
  check("expired crashed lease recovered",(await worker(first)).status==="completed"&&count()===before+2);
  const failed=await create();
  check("inference failure persisted",(await worker(failed,0,1)).status==="failed"&&(await state(failed)).last_error!==null);
  await prisma.$executeRaw`UPDATE "ImageEmbeddingJob" SET next_run_at=(now() AT TIME ZONE 'UTC')-interval '1 second' WHERE post_type='lost' AND post_id=${failed}`;
  check("failed inference retry succeeds",(await worker(failed)).status==="completed");
  const changed=await create(), started=count(), active=worker(changed,2000);
  await waitStart(started);await prisma.lostPost.update({where:{id:changed},data:{imageUrl:photo(changed,"b")}});await active;
  const latest=await state(changed);
  check("changed input coalesced and latest vector saved",latest.state==="completed"&&latest.completed_hash===latest.desired_hash&&JSON.parse(latest.vector)[1]===1&&count()===started+2);
  const cleared=await create(), at=count(), clearing=worker(cleared,2000);
  await waitStart(at);await prisma.lostPost.update({where:{id:cleared},data:{imageUrl:null}});await clearing;
  check("removed image never resurrected",(await state(cleared)).vector===null&&(await state(cleared)).desired_hash===null);
} finally {
  try {
    if(user){const own=await prisma.user.findUnique({where:{id:user.id}});if(own?.email!==`${marker}@image-jobs.example.invalid`)throw new Error("Cleanup ownership mismatch");
      await prisma.$transaction(async tx=>{await tx.lostPost.deleteMany({where:{id:{in:posts},userId:user.id}});await tx.rateLimitCounter.deleteMany({where:{OR:["embeddingRecompute","embeddingAutomatic"].map(a=>({key:{startsWith:`${a}:u:${user.id}:`}})).concat(posts.map(id=>({key:{startsWith:`embeddingLostPost:u:${id}:`}})))}});await tx.user.delete({where:{id:user.id}});});
      console.log(JSON.stringify({cleanup:true,userId:user.id,postIds:posts}));}
  } finally {await prisma.$disconnect();if(existsSync(logFile))unlinkSync(logFile);}
}
process.exit(0);
