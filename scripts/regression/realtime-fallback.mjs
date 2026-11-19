// Preview fixtures + isolated local Auth.js secret. Never accepts Production.
import "../db/install-guard.mjs";
import {assertDatabaseEnvironment,assertScriptSupabaseAccess} from "../../src/lib/db/accessPolicy.mjs";
import {createJiti} from "jiti";
import {createRequire} from "node:module";
import {pathToFileURL,fileURLToPath} from "node:url";
import {randomUUID} from "node:crypto";
import {execFile,spawn} from "node:child_process";
import {writeFileSync} from "node:fs";
import {createInterface} from "node:readline";
import {once} from "node:events";
import {promisify} from "node:util";
import {loadApprovedPreviewRealtimeKey} from "../operations/preview-realtime-manual-state.mjs";
if(!process.argv.includes("--confirm-preview")||assertDatabaseEnvironment(process.env,{usage:"operation"})!=="preview"||assertScriptSupabaseAccess(process.env)!=="preview")throw new Error("Preview confirmation required");
const receiptMode=process.argv.includes("--browser-receipt");
const privateMode=process.argv.includes("--private")||receiptMode;
const cutoverMode=process.argv.includes("--legacy-cutover");
const expectPublicOff=process.argv.includes("--expect-public-off");
if(privateMode&&cutoverMode)throw new Error("Select one browser suite");
if(expectPublicOff&&!cutoverMode)throw new Error("--expect-public-off requires --legacy-cutover in the browser runner");
const signingKey=privateMode?JSON.stringify(await loadApprovedPreviewRealtimeKey()):"";
const marker=`realtime-${randomUUID()}`,users=[];let room,server,cleanupOk=false;
const manifest=`.vercel/${marker}.json`;
const save=()=>writeFileSync(manifest,JSON.stringify({marker,userIds:users.map(u=>u.id),roomId:room?.id}));
const jiti=createJiti(import.meta.url,{alias:{"@":fileURLToPath(new URL("../../src",import.meta.url))}});
const {prisma}=await jiti.import("../../src/lib/db/prisma.ts"),terms=await jiti.import("../../src/lib/auth/terms.ts");
const require=createRequire(import.meta.url);const {encode}=await import(pathToFileURL(require.resolve("@auth/core/jwt")));
const secret=randomUUID()+randomUUID(),base="http://localhost:3102",sessions=[];
async function startServer(cwd=process.cwd()){
  server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p","3102"],{cwd,env:{...process.env,AUTH_SECRET:secret,AUTH_TRUST_HOST:"true",MJU_REALTIME_PRIVATE_JWK:signingKey},stdio:"ignore",windowsHide:true});
  server.once("error",()=>{});
  for(let i=0;i<30;i++){
    if(server.exitCode!==null||server.signalCode!==null)break;
    try{if((await fetch(base+"/api/version",{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw new Error("Local server unavailable");
}
async function stopServer(){
  if(!server||server.exitCode!==null||server.signalCode!==null)return;
  const exited=once(server,"exit");
  server.kill();
  await exited;
}
try{
  // Refuse an occupied port rather than reuse an unknown server.
  const {createServer}=await import("node:net");await new Promise((resolve,reject)=>{const probe=createServer();probe.once("error",reject);probe.listen(3102,"127.0.0.1",()=>probe.close(resolve));});
  for(let i=0;i<3;i++){
    const user=await prisma.user.create({data:{email:`${marker}-${i}@test.example.invalid`,name:"Synthetic realtime",nickname:`Realtime ${i}`,privacyConsentAt:new Date(),privacyConsentVersion:terms.CURRENT_PRIVACY_VERSION,termsAcceptedAt:new Date(),termsVersion:terms.CURRENT_TERMS_VERSION,identityConsentVersion:terms.CURRENT_IDENTITY_CONSENT_VERSION}});
    users.push(user);save();
    await prisma.userIdentityInfo.create({data:{userId:user.id,realName:"Synthetic",department:"Synthetic",consentVersion:terms.CURRENT_IDENTITY_CONSENT_VERSION,consentedAt:new Date()}});
    const legacySession=(privateMode||cutoverMode)&&i===0;
    const token={sub:String(user.id),userId:user.id,nickname:user.nickname};
    if(!legacySession)token.realtimeSessionId=randomUUID();
    sessions.push(await encode({token,secret,salt:"authjs.session-token"}));
  }
  room=await prisma.chatRoom.create({data:{initiatorUserId:users[0].id,counterpartUserId:users[1].id,postType:"lost",postTitle:marker}});save();
  // The default suite intentionally leaves the signer absent; --private
  // uses only the already-imported Preview checkpoint in process memory.
  await startServer(cutoverMode?".vercel/d3-cutover-d2-8baa381":undefined);
  const suite=cutoverMode?"realtime-cutover":receiptMode?"realtime-browser-receipt":privateMode?"realtime-private":"realtime-fallback";
  const receiptCutoff=new Date().toISOString();
  const browser=spawn("python",[`scripts/regression/${suite}.py`],{stdio:["pipe","pipe","pipe"],windowsHide:true,timeout:cutoverMode?120000:300000});
  const config=JSON.stringify({base,roomId:room.id,cookies:sessions,legacySession:privateMode,expectPublicOff});
  let output="",stage;browser.stderr.resume();
  let switchTask;
  let receiptTask;
  const lines=createInterface({input:browser.stdout});
  lines.on("line",line=>{
    const progress=/^stage:(initial|polling|renewal|completed)$/.exec(line);
    if(progress){stage=progress[1];return;}
    if(receiptMode&&line==="operator-receipt"){
      receiptTask=(async()=>{
        const result=await promisify(execFile)(process.execPath,["scripts/operations/realtime-member-check.mjs","send","--confirm-preview",String(room.id),receiptCutoff],{timeout:15000,windowsHide:true});
        browser.stdin.write(JSON.stringify({nonce:JSON.parse(result.stdout).expectedReceipt})+"\n");
      })().catch(()=>browser.stdin.write("{}\n"));
      return;
    }
    if(!cutoverMode||line!=="switch-local-server"){output+=line;return;}
    if(switchTask)return;
    switchTask=(async()=>{await stopServer();await startServer();browser.stdin.end("switched\n");})().catch(()=>browser.stdin.end("switch-failed\n"));
  });
  if(cutoverMode||receiptMode){
    browser.stdin.on("error",()=>{});
    browser.stdin.write(config+"\n");
  }else{
    browser.stdin.end(config);
  }
  const [status,signal]=await once(browser,"close");
  await switchTask;
  await receiptTask;
  if(status!==0){
    console.log(JSON.stringify({browserExit:status,signal,stage}));
    try{const failed=JSON.parse(output);console.log(JSON.stringify({completedChecks:failed.completedChecks,errorType:failed.errorType,line:failed.line,counters:failed.counters}));}catch{}
    throw new Error("Browser verification failed; no private data emitted");
  }
  const result=JSON.parse(output);if(!result.passed)throw new Error("Browser result missing");console.log(JSON.stringify(result));
}catch(error){console.error(error.message.startsWith("Browser")?error.message:"Browser setup failed; diagnostics suppressed");process.exitCode=1;}
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
  console.log(JSON.stringify({suite:"D3 browser fixture cleanup",cleanupOk,userIds:users.map(u=>u.id),roomId:room?.id}));await prisma.$disconnect();
}
process.exit(process.exitCode??0);
