// Real hosted Preview membership/RLS probes. Only newly recorded fixtures.
import "../db/install-guard.mjs";
import {createJiti} from "jiti";
import {fileURLToPath} from "node:url";
import {randomUUID} from "node:crypto";
import {writeFileSync,mkdirSync} from "node:fs";
import {RealtimeClient} from "@supabase/realtime-js";
import {decodeJwt,importJWK,SignJWT} from "jose";
import {loadApprovedPreviewRealtimeKey} from "../operations/preview-realtime-manual-state.mjs";
import {PREVIEW_DB_PROJECT} from "../../src/lib/db/accessPolicy.mjs";
if(!process.argv.includes("--confirm-preview"))throw new Error("Preview confirmation required");
const key=await loadApprovedPreviewRealtimeKey();
process.env.MJU_REALTIME_PRIVATE_JWK=JSON.stringify(key);
const publicKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY??process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if(!publicKey||publicKey==="[SENSITIVE]")throw new Error("Preview public key required");
const jiti=createJiti(import.meta.url,{alias:{"@":fileURLToPath(new URL("../../src",import.meta.url))}});
const {prisma}=await jiti.import("../../src/lib/db/prisma.ts"),terms=await jiti.import("../../src/lib/auth/terms.ts");
const grants=await jiti.import("../../src/lib/chat/realtimeGrants.ts");
const marker=`private-realtime-${randomUUID()}`,users=[],rooms=[],clients=[],results=[],organizations=[];
const manifest=`.vercel/${marker}.json`;
mkdirSync(".vercel",{recursive:true});
const save=()=>writeFileSync(manifest,JSON.stringify({marker,userIds:users.map(u=>u.id),roomIds:rooms.map(r=>r.id),organizationIds:organizations.map(o=>o.id)}));
const must=(ok,name)=>{results.push({name,passed:!!ok});if(!ok)throw new Error("Assertion failed");};
let cleanupOk=false;
function denialKind(error){
  const text=String(error?.message??error??"");
  if(/signature|JwtSignature|InvalidJWT|JWT.*invalid|invalid.*JWT/i.test(text))return "jwt-validation";
  if(/permission denied|set role|insufficient_privilege/i.test(text))return "database-role";
  if(/authoriz|polic|forbidden/i.test(text))return "authorization";
  return "unclassified";
}
async function join(token,topic,privateChannel=true){
  const client=new RealtimeClient(`https://${PREVIEW_DB_PROJECT}.supabase.co/realtime/v1`,{params:{apikey:publicKey}});clients.push(client);
  await client.setAuth(token);
  const observed=[];
  const channel=client.channel(topic,{config:{private:privateChannel,broadcast:{ack:true}}}).on("broadcast",{event:"message"},({payload})=>observed.push(payload.eventId));
  const result=await new Promise(resolve=>{
    const timer=setTimeout(()=>resolve({status:"TIMEOUT"}),15000);
    channel.subscribe((status,error)=>{if(["SUBSCRIBED","CHANNEL_ERROR","TIMED_OUT"].includes(status)){clearTimeout(timer);resolve({status,denial:status==="CHANNEL_ERROR"?denialKind(error):undefined});}});
  });
  if(result.status!=="SUBSCRIBED")await client.disconnect();
  return {...result,client,channel,observed};
}
let admin;
async function authorizedSend(room,issue,eventId){
  let attempted=false;
  await grants.withAuthorizedChatRealtimeTopic(room,issue.topic,async()=>{
    attempted=true;
    if(!admin){admin=new RealtimeClient(`https://${PREVIEW_DB_PROJECT}.supabase.co/realtime/v1`,{params:{apikey:publicKey}});clients.push(admin);await admin.setAuth(process.env.SUPABASE_SERVICE_ROLE_KEY);}
    await admin.channel(issue.topic,{config:{private:true}}).httpSend("message",{eventId,messageId:2147483647},{timeout:1500});
  });
  return attempted;
}
async function delivered(receiver,eventId){
  const until=Date.now()+5000;while(!receiver.observed.includes(eventId)&&Date.now()<until)await new Promise(r=>setTimeout(r,50));
  return receiver.observed.includes(eventId);
}
async function rejectJoin(name,token,topic){const r=await join(token,topic);must(r.status==="CHANNEL_ERROR",name);}
try{
  const config=(await prisma.$queryRaw`SELECT mode,project_ref,signing_kid::text FROM "ChatRealtimeConfig" WHERE id=true`)[0];
  must(config?.mode==="private"&&config.project_ref===PREVIEW_DB_PROJECT&&config.signing_kid===key.kid,"Preview private configuration matches approved key");
  for(let i=0;i<3;i++){
    const user=await prisma.user.create({data:{email:`${marker}-${i}@test.example.invalid`,name:"Synthetic private realtime",nickname:`Private realtime ${i}`,privacyConsentAt:new Date(),privacyConsentVersion:terms.CURRENT_PRIVACY_VERSION,termsAcceptedAt:new Date(),termsVersion:terms.CURRENT_TERMS_VERSION,identityConsentVersion:terms.CURRENT_IDENTITY_CONSENT_VERSION}});
    users.push(user);save();
  }
  rooms.push(await prisma.chatRoom.create({data:{initiatorUserId:users[0].id,counterpartUserId:users[1].id,postType:"lost",postTitle:marker}}));save();
  const session={id:randomUUID(),expiresAt:Math.floor(Date.now()/1000)+3600};
  const issue=await grants.issueChatRealtimeGrant(users[0],session,rooms[0].id);
  must(issue.kind==="ok","Member grant issued");
  const member=await join(issue.token,issue.topic);
  console.log(JSON.stringify({probe:"approved Standby key member join",status:member.status,denial:member.denial,project:PREVIEW_DB_PROJECT,kid:key.kid,tokenEmitted:false}));
  must(member.status==="SUBSCRIBED","Standby-signed member private join accepted");
  const publicNamesake=await join(publicKey,issue.topic,false);
  must(["SUBSCRIBED","CHANNEL_ERROR"].includes(publicNamesake.status),"Same-name public probe has a conclusive join result");
  const eventId=randomUUID();
  await authorizedSend(rooms[0].id,issue,eventId);
  must(await delivered(member,eventId),"Server authorized private delivery received");
  await new Promise(r=>setTimeout(r,500));
  must(!publicNamesake.observed.includes(eventId),"Same-name anonymous public channel receives no private event");
  const secondTab=await join(issue.token,issue.topic);
  must(secondTab.status==="SUBSCRIBED","Second tab shares signed session topic");
  const directId=randomUUID();
  await member.channel.send({type:"broadcast",event:"message",payload:{eventId:directId,messageId:2147483647}});
  const restId=randomUUID();
  const directRest=await fetch(`https://${PREVIEW_DB_PROJECT}.supabase.co/realtime/v1/api/broadcast`,{method:"POST",headers:{apikey:publicKey,Authorization:`Bearer ${issue.token}`,"content-type":"application/json"},body:JSON.stringify({messages:[{topic:issue.topic,event:"message",payload:{eventId:restId},private:true}]}),redirect:"error",signal:AbortSignal.timeout(10000)});
  await directRest.body?.cancel();
  const controlId=randomUUID();await authorizedSend(rooms[0].id,issue,controlId);
  must(await delivered(secondTab,controlId),"Second tab receives server positive control");
  await new Promise(r=>setTimeout(r,1500));
  must(!secondTab.observed.includes(directId)&&!member.observed.includes(directId),"Member direct WebSocket broadcast not delivered");
  must(!secondTab.observed.includes(restId)&&!member.observed.includes(restId),"Member direct REST broadcast not delivered");
  must((await grants.issueChatRealtimeGrant(users[2],{id:randomUUID(),expiresAt:session.expiresAt},rooms[0].id)).kind==="forbidden","Outsider cannot obtain a room grant");
  await rejectJoin("Anonymous private subscription denied",publicKey,issue.topic);
  rooms.push(await prisma.chatRoom.create({data:{initiatorUserId:users[0].id,counterpartUserId:users[2].id,postType:"lost",postTitle:marker}}));save();
  const other=await grants.issueChatRealtimeGrant(users[0],session,rooms[1].id);must(other.kind==="ok","Other-room member grant issued");
  await rejectJoin("Valid token cannot subscribe to another room topic",issue.token,other.topic);
  await rejectJoin("Valid token cannot use a guessed public topic",issue.token,`chat-room-${rooms[0].id}`);
  const claims=decodeJwt(issue.token),signingKey=await importJWK(key,"ES256");
  const patched=patch=>new SignJWT({...claims,...patch}).setProtectedHeader({alg:"ES256",kid:key.kid,typ:"JWT"}).sign(signingKey);
  const parts=issue.token.split(".");parts[2]=(parts[2][0]==="A"?"B":"A")+parts[2].slice(1);
  await rejectJoin("Tampered token signature denied",parts.join("."),issue.topic);
  for(const [name,patch]of [
    ["Expired signed token denied",{exp:Math.floor(Date.now()/1000)-1}],
    ["Future signed token denied",{nbf:Math.floor(Date.now()/1000)+300}],
    ["Other project claims denied on Preview",{project:"tmifqtyxojtuoejxjrng",iss:"https://tmifqtyxojtuoejxjrng.supabase.co/auth/v1"}],
    ["Wrong audience denied",{aud:"authenticated"}],
    ["Wrong scope denied",{scope:"mju.chat.send.v1"}],
    ["Other user claims denied",{app_user_id:users[2].id}],
    ["Other room claims denied",{room_id:rooms[1].id}],
    ["Unknown grant denied",{grant_id:randomUUID()}],
  ])await rejectJoin(name,await patched(patch),issue.topic);
  for(const bucket of ["post-images","chat-images","report-evidence"]){
    const r=await fetch(`https://${PREVIEW_DB_PROJECT}.supabase.co/storage/v1/object/list/${bucket}`,{method:"POST",headers:{apikey:publicKey,Authorization:`Bearer ${issue.token}`,"content-type":"application/json"},body:JSON.stringify({prefix:`${marker}/`,limit:1}),redirect:"error",signal:AbortSignal.timeout(10000)});
    const json=await r.json();must(!r.ok||(Array.isArray(json)&&json.length===0),`Realtime token cannot list ${bucket}`);
  }
  const renewed=await grants.issueChatRealtimeGrant(users[0],session,rooms[0].id);
  must(renewed.kind==="ok"&&renewed.topic===issue.topic,"Renewal reuses session topic");
  await member.client.setAuth(renewed.token);
  const renewedId=randomUUID();await authorizedSend(rooms[0].id,renewed,renewedId);
  must(await delivered(member,renewedId),"Renewed connection receives authorized event");
  // Realtime may cache join RLS. The application's dispatch guard must
  // stop future sends to the already-connected topic after revocation.
  await prisma.chatRealtimeSession.update({where:{id:session.id},data:{revokedAt:new Date()}});
  const deniedId=randomUUID();must(!await authorizedSend(rooms[0].id,renewed,deniedId),"Session revocation prevents dispatch to an existing connection");
  await rejectJoin("Revoked session cannot reconnect",renewed.token,renewed.topic);
  await new Promise(r=>setTimeout(r,500));must(!member.observed.includes(deniedId),"Existing connection receives no post-revocation event");
  const organization=await prisma.organization.create({data:{name:marker,organizationType:"Synthetic test"}});organizations.push(organization);save();
  const membership=await prisma.organizationMember.create({data:{organizationId:organization.id,userId:users[1].id,role:"LEADER"}});
  rooms.push(await prisma.chatRoom.create({data:{initiatorUserId:users[0].id,organizationId:organization.id,postType:"lost",postTitle:marker}}));save();
  const orgSession={id:randomUUID(),expiresAt:session.expiresAt};
  const orgIssue=await grants.issueChatRealtimeGrant(users[1],orgSession,rooms[2].id);must(orgIssue.kind==="ok","Organization manager grant issued");
  const orgReceiver=await join(orgIssue.token,orgIssue.topic);must(orgReceiver.status==="SUBSCRIBED","Organization manager private join accepted");
  const orgId=randomUUID();await authorizedSend(rooms[2].id,orgIssue,orgId);must(await delivered(orgReceiver,orgId),"Organization manager receives authorized event");
  await prisma.organizationMember.update({where:{id:membership.id},data:{role:"MEMBER"}});
  must(!await authorizedSend(rooms[2].id,orgIssue,randomUUID()),"Manager demotion stops already-connected dispatch");
  await rejectJoin("Demoted manager cannot reconnect",orgIssue.token,orgIssue.topic);
  await prisma.organizationMember.update({where:{id:membership.id},data:{role:"LEADER"}});
  await rejectJoin("Manager reapproval does not resurrect old token",orgIssue.token,orgIssue.topic);
  const newOrgIssue=await grants.issueChatRealtimeGrant(users[1],orgSession,rooms[2].id);
  must(newOrgIssue.kind==="ok"&&newOrgIssue.topic!==orgIssue.topic,"Reapproved manager receives a new isolated topic");
  const withdrawn=await grants.issueChatRealtimeGrant(users[2],{id:randomUUID(),expiresAt:session.expiresAt},rooms[1].id);must(withdrawn.kind==="ok","Withdrawal fixture grant issued");
  const withdrawnReceiver=await join(withdrawn.token,withdrawn.topic);must(withdrawnReceiver.status==="SUBSCRIBED","Withdrawal fixture joins before revocation");
  await prisma.user.update({where:{id:users[2].id},data:{deletedAt:new Date()}});
  must(!await authorizedSend(rooms[1].id,withdrawn,randomUUID()),"Account withdrawal stops existing-connection dispatch");
  await rejectJoin("Withdrawn account cannot reconnect",withdrawn.token,withdrawn.topic);
}catch{
  console.error("Private Realtime verification stopped; no key, token or provider diagnostics emitted");process.exitCode=1;
}finally{
  await Promise.allSettled(clients.map(c=>c.disconnect()));
  try{
    for(const [i,u]of users.entries())if((await prisma.user.findUnique({where:{id:u.id}}))?.email!==`${marker}-${i}@test.example.invalid`)throw new Error("Fixture ownership differs");
    for(const r of rooms){const row=await prisma.chatRoom.findUnique({where:{id:r.id}});if(row?.postTitle!==marker||row.initiatorUserId!==users[0].id||row.counterpartUserId!==r.counterpartUserId||row.organizationId!==r.organizationId)throw new Error("Room ownership differs");}
    for(const o of organizations)if((await prisma.organization.findUnique({where:{id:o.id}}))?.name!==marker)throw new Error("Organization ownership differs");
    await prisma.$transaction(async tx=>{
      for(const r of rooms)await tx.chatRoom.delete({where:{id:r.id}});
      for(const o of organizations)await tx.organization.delete({where:{id:o.id}});
      for(const u of users){await tx.rateLimitCounter.deleteMany({where:{OR:["realtimeToken","chatSync"].map(a=>({key:{startsWith:`${a}:u:${u.id}:`}}))}});await tx.user.delete({where:{id:u.id}});}
    });cleanupOk=true;
  }catch{console.error("Fixture cleanup failed; preserve recorded IDs");process.exitCode=1;}
  console.log(JSON.stringify({suite:"D3 Standby private Realtime",passed:results.filter(r=>r.passed).length,results,cleanupOk,userIds:users.map(u=>u.id),roomIds:rooms.map(r=>r.id)}));
  await prisma.$disconnect();
}
process.exit(process.exitCode??0);
