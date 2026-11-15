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
if(mode==="worker"||mode==="legacy") {
  const {getImageEmbeddingProvider}=await jiti.import("../../src/lib/ai/imageEmbedding.ts");
  getImageEmbeddingProvider().embed=async url=>{
    appendFileSync(log,JSON.stringify({started:true})+"\n");
    await new Promise(r=>setTimeout(r,Number(delay)));
    if(fail==="1")throw new Error("SyntheticInferenceFailure");
    return Array.from({length:768},(_,i)=>i===(mode==="legacy"?2:url.endsWith("b.jpg")?1:0)?1:0);
  };
  const {runImageJob,runLatestImageJob}=await jiti.import("../../src/lib/ai/imageJob.ts");
  // Exact old inference/save protocol from cb3bb71 postEmbedding.ts, before
  // its compatibility entry point was changed to use the new controller.
  try { const post=await prisma.lostPost.findUnique({where:{id:Number(rawId)},include:{user:true}}); if(!post?.user.email.endsWith("@image-jobs.example.invalid"))throw new Error("Not a fixture"); let r;if(mode==="legacy"){const {saveImageEmbedding}=await jiti.import("../../src/lib/ai/vectorSearch.ts");await saveImageEmbedding("lost",post.id,await getImageEmbeddingProvider().embed(post.imageUrl));r={status:"legacy_finished"};}else{r=delay!=="0"?await runLatestImageJob("lost",post.id):await runImageJob("lost",post.id,true);} console.log(JSON.stringify(r??{status:"drained"})); }
  finally {await prisma.$disconnect();}
  process.exit(0);
}
const marker=randomUUID(), posts=[];let user, runtimePaused=false;
mkdirSync(".vercel",{recursive:true});
const logFile=`.vercel/image-jobs-${marker}.jsonl`;writeFileSync(logFile,"");
const manifest=`.vercel/image-job-run-${marker}.json`;
function recordRun(cleaned=false){writeFileSync(manifest,JSON.stringify({marker,userId:user?.id??null,postIds:posts,paths:posts.map(id=>`posts/lost/${id}/`),cleaned},null,2));}
recordRun();
const count=()=>readFileSync(logFile,"utf8").trim().split("\n").filter(Boolean).length;
const check=(name,ok)=>{console.log(JSON.stringify({check:name,passed:!!ok}));if(!ok)throw new Error(name);};
const photo=(id,name)=>`https://${PREVIEW_DB_PROJECT}.supabase.co/storage/v1/object/public/post-images/posts/lost/${id}/${name}.jpg`;
function worker(id,delay=0,fail=0,onChild=()=>{},legacy=false) {return new Promise((resolve,reject)=>{const c=spawn(process.execPath,[fileURLToPath(import.meta.url),legacy?"legacy":"worker",String(id),logFile,String(delay),String(fail)],{env:process.env,windowsHide:true});onChild(c);let out="";c.stdout.on("data",b=>out+=b);c.stderr.on("data",()=>{});c.on("error",()=>reject(new Error("Worker could not start")));c.on("close",code=>{if(code!==0)return reject(new Error("Worker failed"));try{resolve(JSON.parse(out.trim().split("\n").at(-1)));}catch{reject(new Error("Worker output invalid"));}});});}
async function create() {const p=await prisma.lostPost.create({data:{userId:user.id,title:`Image job ${marker}`,description:"Synthetic fixture",category:"기타",location:"Synthetic fixture",lostDate:new Date()}});posts.push(p.id);recordRun();await prisma.lostPost.update({where:{id:p.id},data:{imageUrl:photo(p.id,"a")}});return p.id;}
async function state(id) {return (await prisma.$queryRaw`SELECT p.image_url,p."imageEmbedding"::text AS vector,j.* FROM "LostPost" p JOIN "ImageEmbeddingJob" j ON j.post_type='lost' AND j.post_id=p.id WHERE p.id=${id}`)[0];}
async function waitStart(previous) {for(let i=0;i<200;i++){if(count()>previous)return;await new Promise(r=>setTimeout(r,50));}throw new Error("Worker did not infer");}
try {
  user=await prisma.user.create({data:{email:`${marker}@image-jobs.example.invalid`,name:"Synthetic image worker",nickname:"Synthetic fixture",isAdmin:true}});
  recordRun();
  const ready=(await prisma.$queryRaw`SELECT enabled AND resume_at <= (clock_timestamp() AT TIME ZONE 'UTC') ready FROM "ImageEmbeddingRuntime" WHERE id=true`)[0];
  check("Preview runtime ready before testing",ready?.ready===true);
  const first=await create(), before=count();
  const concurrent=await Promise.all(Array.from({length:4},()=>worker(first)));
  check("four processes infer exactly once",count()===before+1&&concurrent.some(r=>r.status==="completed"));
  check("identical input reused",(await worker(first)).status==="reused"&&count()===before+1);
  const outdated=(await prisma.$queryRaw`UPDATE "ImageEmbeddingJob" SET lease_token='pre-fence-worker',lease_until=(now() AT TIME ZONE 'UTC')+interval '150 seconds',state='running' WHERE post_type='lost' AND post_id=${first} RETURNING post_id`);
  check("old D2 claim protocol rejected before inference",outdated.length===0);
  await prisma.$executeRaw`UPDATE "ImageEmbeddingJob" SET state='running',lease_token='image-v2:simulated-crash',lease_until=(now() AT TIME ZONE 'UTC')-interval '1 second' WHERE post_type='lost' AND post_id=${first}`;
  check("expired crashed lease recovered",(await worker(first)).status==="completed"&&count()===before+2);
  await prisma.$executeRaw`UPDATE "ImageEmbeddingJob" SET state='running',attempts=5,lease_token='image-v2:last-attempt-crash',lease_until=(now() AT TIME ZONE 'UTC')-interval '1 second' WHERE post_type='lost' AND post_id=${first}`;
  check("explicit retry recovers final-attempt crash",(await worker(first)).status==="completed"&&count()===before+3);
  await prisma.matchCandidateCache.create({data:{sourceType:"lost",sourcePostId:first,candidates:{scale:"synthetic",ranking:[]}}});
  await prisma.lostPost.update({where:{id:first},data:{imageUrl:photo(first,"b")}});
  check("photo change atomically invalidates old vector and ranking",(await prisma.matchCandidateCache.count({where:{sourceType:"lost",sourcePostId:first}}))===0&&(await state(first)).vector===null);
  check("new input runs after atomic invalidation",(await worker(first)).status==="completed");
  const mixed=await create(), mixedStart=count();
  const legacy=worker(mixed,3000,0,()=>{},true);
  await waitStart(mixedStart);
  check("legacy inference bypass is detected",(await state(mixed)).lease_token===null);
  await prisma.lostPost.update({where:{id:mixed},data:{imageUrl:photo(mixed,"b")}});
  check("new worker completes latest input alongside legacy process",(await worker(mixed)).status==="completed");
  await legacy;
  const preserved=await state(mixed);
  check("late legacy result cannot overwrite latest vector",JSON.parse(preserved.vector)[1]===1&&preserved.desired_hash===preserved.completed_hash);
  await prisma.$executeRaw`UPDATE "LostPost" SET "imageEmbedding"=NULL WHERE id=${mixed}`;
  check("legacy late NULL cannot clear latest vector",(await state(mixed)).vector===preserved.vector);
  await prisma.$executeRaw`UPDATE "ImageEmbeddingJob" SET state='running',lease_token='image-v2:old-inflight',lease_until=(now() AT TIME ZONE 'UTC')+interval '150 seconds' WHERE post_type='lost' AND post_id=${mixed}`;
  await prisma.$executeRaw`UPDATE "ImageEmbeddingJob" SET state='completed',completed_hash=desired_hash,lease_token=NULL,lease_until=NULL WHERE post_type='lost' AND post_id=${mixed}`;
  check("old inflight D2 cannot falsely complete a job",(await state(mixed)).state==="pending"&&(await state(mixed)).lease_token===null);
  check("discarded old completion remains recoverable",(await worker(mixed)).status==="completed");
  const paused=await create(), pauseStart=count();
  runtimePaused=true;await prisma.$executeRaw`UPDATE "ImageEmbeddingRuntime" SET enabled=false,resume_at=NULL WHERE id=true`;
  check("paused deployment retains queued input without inference",(await worker(paused)).status==="pending"&&count()===pauseStart&&(await state(paused)).state==="pending");
  await worker(paused,0,0,()=>{},true);
  check("rollback legacy writer cannot store an unfenced vector",(await state(paused)).vector===null&&(await state(paused)).state==="pending");
  await prisma.$executeRaw`UPDATE "ImageEmbeddingRuntime" SET enabled=true,resume_at=(clock_timestamp() AT TIME ZONE 'UTC')+interval '60 seconds' WHERE id=true`;
  check("drain deadline blocks premature inference",(await worker(paused)).status==="pending"&&count()===pauseStart+1);
  await prisma.$executeRaw`UPDATE "ImageEmbeddingRuntime" SET enabled=true,resume_at=(clock_timestamp() AT TIME ZONE 'UTC') WHERE id=true`;runtimePaused=false;
  check("queued work recovers after rollout or rollback pause",(await worker(paused)).status==="completed");
  const crashed=await create(), crashStart=count();let victim;
  const stopped=worker(crashed,30000,0,c=>{victim=c;}).then(()=>false,()=>true);
  await waitStart(crashStart);victim.kill("SIGKILL");
  check("actual worker termination leaves an unfinished lease",await stopped&&(await state(crashed)).state==="running"&&(await state(crashed)).vector===null);
  // Only this isolated test lease is advanced, avoiding a 150-second sleep.
  await prisma.$executeRaw`UPDATE "ImageEmbeddingJob" SET lease_until=(now() AT TIME ZONE 'UTC')-interval '1 second' WHERE post_type='lost' AND post_id=${crashed}`;
  check("terminated worker recovered after lease expiry",(await worker(crashed)).status==="completed");
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
    if(runtimePaused)await prisma.$executeRaw`UPDATE "ImageEmbeddingRuntime" SET enabled=true,resume_at=(clock_timestamp() AT TIME ZONE 'UTC') WHERE id=true`;
    if(user){const own=await prisma.user.findUnique({where:{id:user.id}});if(own?.email!==`${marker}@image-jobs.example.invalid`)throw new Error("Cleanup ownership mismatch");
      await prisma.$transaction(async tx=>{await tx.lostPost.deleteMany({where:{id:{in:posts},userId:user.id}});await tx.matchCandidateCache.deleteMany({where:{sourceType:"lost",sourcePostId:{in:posts}}});await tx.rateLimitCounter.deleteMany({where:{OR:["embeddingRecompute","embeddingAutomatic"].map(a=>({key:{startsWith:`${a}:u:${user.id}:`}})).concat(posts.map(id=>({key:{startsWith:`embeddingLostPost:u:${id}:`}})))}});await tx.user.delete({where:{id:user.id}});});
      recordRun(true);console.log(JSON.stringify({cleanup:true,userId:user.id,postIds:posts}));}
  } finally {await prisma.$disconnect();if(existsSync(logFile))unlinkSync(logFile);}
}
process.exit(0);
