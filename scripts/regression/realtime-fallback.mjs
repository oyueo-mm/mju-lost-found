// Preview fixtures + isolated local Auth.js secret. Never accepts Production.
import "../db/install-guard.mjs";
import {assertDatabaseEnvironment} from "../../src/lib/db/accessPolicy.mjs";
import {createJiti} from "jiti";
import {createRequire} from "node:module";
import {pathToFileURL,fileURLToPath} from "node:url";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {writeFileSync} from "node:fs";
import {loadApprovedPreviewRealtimeKey} from "../operations/preview-realtime-manual-state.mjs";
if(!process.argv.includes("--confirm-preview")||assertDatabaseEnvironment(process.env,{usage:"operation"})!=="preview")throw new Error("Preview confirmation required");
const privateMode=process.argv.includes("--private");
const signingKey=privateMode?JSON.stringify(await loadApprovedPreviewRealtimeKey()):"";
const marker=`realtime-${randomUUID()}`,users=[];let room,server,cleanupOk=false;
const manifest=`.vercel/${marker}.json`;
const save=()=>writeFileSync(manifest,JSON.stringify({marker,userIds:users.map(u=>u.id),roomId:room?.id}));
const jiti=createJiti(import.meta.url,{alias:{"@":fileURLToPath(new URL("../../src",import.meta.url))}});
const {prisma}=await jiti.import("../../src/lib/db/prisma.ts"),terms=await jiti.import("../../src/lib/auth/terms.ts");
const require=createRequire(import.meta.url);const {encode}=await import(pathToFileURL(require.resolve("@auth/core/jwt")));
const secret=randomUUID()+randomUUID(),base="http://localhost:3102",sessions=[];
try{
  // Refuse an occupied port rather than reuse an unknown server.
  const {createServer}=await import("node:net");await new Promise((resolve,reject)=>{const probe=createServer();probe.once("error",reject);probe.listen(3102,"127.0.0.1",()=>probe.close(resolve));});
  for(let i=0;i<3;i++){
    const user=await prisma.user.create({data:{email:`${marker}-${i}@test.example.invalid`,name:"Synthetic realtime",nickname:`Realtime ${i}`,privacyConsentAt:new Date(),privacyConsentVersion:terms.CURRENT_PRIVACY_VERSION,termsAcceptedAt:new Date(),termsVersion:terms.CURRENT_TERMS_VERSION,identityConsentVersion:terms.CURRENT_IDENTITY_CONSENT_VERSION}});
    users.push(user);save();
    await prisma.userIdentityInfo.create({data:{userId:user.id,realName:"Synthetic",department:"Synthetic",consentVersion:terms.CURRENT_IDENTITY_CONSENT_VERSION,consentedAt:new Date()}});
    sessions.push(await encode({token:{sub:String(user.id),userId:user.id,nickname:user.nickname,realtimeSessionId:randomUUID()},secret,salt:"authjs.session-token"}));
  }
  room=await prisma.chatRoom.create({data:{initiatorUserId:users[0].id,counterpartUserId:users[1].id,postType:"lost",postTitle:marker}});save();
  // The default suite intentionally leaves the signer absent; --private
  // uses only the already-imported Preview checkpoint in process memory.
  server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p","3102"],{env:{...process.env,AUTH_SECRET:secret,AUTH_TRUST_HOST:"true",MJU_REALTIME_PRIVATE_JWK:signingKey},stdio:"ignore",windowsHide:true});
  for(let i=0;;i++){try{if((await fetch(base+"/api/version")).ok)break;}catch{}if(i>=29)throw new Error("Local server unavailable");await new Promise(r=>setTimeout(r,1000));}
  const browser=spawn("python",[privateMode?"scripts/regression/realtime-private.py":"scripts/regression/realtime-fallback.py"],{stdio:["pipe","pipe","pipe"],windowsHide:true});
  browser.stdin.end(JSON.stringify({base,roomId:room.id,cookies:sessions}));
  let output="";browser.stdout.on("data",b=>output+=b);browser.stderr.resume();
  const status=await new Promise(resolve=>browser.once("close",resolve));
  if(status!==0){try{const failed=JSON.parse(output);console.log(JSON.stringify({completedChecks:failed.completedChecks,errorType:failed.errorType,line:failed.line,counters:failed.counters}));}catch{}throw new Error("Fallback browser verification failed; no private data emitted");}
  const result=JSON.parse(output);if(!result.passed)throw new Error("Fallback browser result missing");console.log(JSON.stringify(result));
}catch(error){console.error(error.message.startsWith("Fallback")?error.message:"Fallback setup failed; diagnostics suppressed");process.exitCode=1;}
finally{
  server?.kill();
  try{
    for(const [i,u]of users.entries())if((await prisma.user.findUnique({where:{id:u.id}}))?.email!==`${marker}-${i}@test.example.invalid`)throw new Error("Fixture ownership differs");
    if(room){const r=await prisma.chatRoom.findUnique({where:{id:room.id}});if(r?.postTitle!==marker||r.initiatorUserId!==users[0].id||r.counterpartUserId!==users[1].id)throw new Error("Room ownership differs");}
    await prisma.$transaction(async tx=>{
      if(room)await tx.chatRoom.delete({where:{id:room.id}});
      for(const u of users){await tx.notification.deleteMany({where:{userId:u.id}});await tx.rateLimitCounter.deleteMany({where:{OR:["chatSync","realtimeToken","chatMessage"].map(a=>({key:{startsWith:`${a}:u:${u.id}:`}}))}});await tx.user.delete({where:{id:u.id}});}
    });cleanupOk=true;
  }catch{console.error("Fixture cleanup failed; keep recorded IDs");process.exitCode=1;}
  console.log(JSON.stringify({suite:privateMode?"D3 private browser fixture cleanup":"D3 fallback fixture cleanup",cleanupOk,userIds:users.map(u=>u.id),roomId:room?.id}));await prisma.$disconnect();
}
process.exit(process.exitCode??0);
