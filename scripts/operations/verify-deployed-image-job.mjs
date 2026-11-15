// Preview only. Real deployed model; no deployed auth secret or runtime stub.
import "../db/install-guard.mjs";
import { assertDatabaseEnvironment, PREVIEW_DB_PROJECT } from "../../src/lib/db/accessPolicy.mjs";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
if(assertDatabaseEnvironment(process.env,{usage:"operation"})!=="preview"||new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname!==`${PREVIEW_DB_PROJECT}.supabase.co`)throw new Error("Preview only");
const jiti=createJiti(import.meta.url,{alias:{"@":fileURLToPath(new URL("../../src",import.meta.url))}});
const {prisma}=await jiti.import("../../src/lib/db/prisma.ts");
const storage=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const marker=randomUUID();let user,post,path;
mkdirSync(".vercel",{recursive:true});
const record=(cleaned=false)=>writeFileSync(`.vercel/deployed-image-job-${marker}.json`,JSON.stringify({marker,userId:user?.id,postId:post?.id,path,cleaned}));
record();
function requestRecovery(){const r=spawnSync('npx --no-install vercel curl "/api/posts?type=lost&mode=keyword&limit=1" --deployment https://mju-lost-found-preview.vercel.app -- --silent --show-error --max-time 90 --output NUL --write-out "%{http_code}"',{shell:true,encoding:"utf8",windowsHide:true});if(r.status||Number(r.stdout.trim())!==200)throw new Error("Preview recovery request failed");}
try{
  user=await prisma.user.create({data:{email:`${marker}@deployed-job.example.invalid`,name:"Deployed model fixture",nickname:"Deployed model fixture"}});record();
  post=await prisma.lostPost.create({data:{userId:user.id,title:`D2 fixture ${marker}`,description:"Synthetic verification",category:"기타",location:"Synthetic verification",lostDate:new Date()}});record();
  path=`posts/lost/${post.id}/${marker}.jpg`;record();
  const bytes=await sharp({create:{width:64,height:64,channels:3,background:{r:200,g:20,b:40}}}).jpeg().toBuffer();
  if((await storage.storage.from("post-images").upload(path,bytes,{contentType:"image/jpeg"})).error)throw new Error("Fixture upload failed");
  await prisma.lostPost.update({where:{id:post.id},data:{imageUrl:`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/post-images/${path}`}});
  let state;
  for(let i=0;i<90;i++){
    if(i%15===0)requestRecovery();
    state=(await prisma.$queryRaw`SELECT j.state,j.desired_hash=j.completed_hash AS current,vector_dims(p."imageEmbedding") AS dimensions FROM "ImageEmbeddingJob" j JOIN "LostPost" p ON p.id=j.post_id WHERE j.post_type='lost' AND j.post_id=${post.id}`)[0];
    if(["completed","failed"].includes(state?.state))break;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  const passed=state?.state==="completed"&&state.current===true&&state.dimensions===768;
  console.log(JSON.stringify({deployedRealModelJob:state,passed}));if(!passed)process.exitCode=1;
}finally{
  try{if(user){
    if((await prisma.user.findUnique({where:{id:user.id}}))?.email!==`${marker}@deployed-job.example.invalid`)throw new Error("Cleanup owner mismatch");
    if(path){if(!path.startsWith(`posts/lost/${post.id}/`))throw new Error("Cleanup path mismatch");if((await storage.storage.from("post-images").remove([path])).error)throw new Error("Storage cleanup failed");
      const at=path.lastIndexOf("/"),left=await storage.storage.from("post-images").list(path.slice(0,at),{search:path.slice(at+1)});if(left.error||left.data.some(o=>o.name===path.slice(at+1)))throw new Error("Storage object remains");}
    await prisma.$transaction(async tx=>{
      if(post){await tx.lostPost.deleteMany({where:{id:post.id,userId:user.id}});await tx.matchCandidateCache.deleteMany({where:{sourceType:"lost",sourcePostId:post.id}});}
      await tx.rateLimitCounter.deleteMany({where:{OR:[{key:{startsWith:`embeddingAutomatic:u:${user.id}:`}},...(post?[{key:{startsWith:`embeddingLostPost:u:${post.id}:`}}]:[])]}});
      await tx.user.delete({where:{id:user.id}});
    });record(true);console.log(JSON.stringify({cleanup:true,userId:user.id,postId:post?.id,originPhotoAbsent:true}));
  }}finally{await prisma.$disconnect();}
}
