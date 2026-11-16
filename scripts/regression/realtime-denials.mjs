// Hosted Preview rejection probes only. No row, message or Storage creation.
import {RealtimeClient} from "@supabase/realtime-js";
import {generateKeyPair,exportJWK,SignJWT} from "jose";
import {randomUUID} from "node:crypto";
import {assertScriptSupabaseAccess,PREVIEW_DB_PROJECT} from "../../src/lib/db/accessPolicy.mjs";
if(!process.argv.includes("--confirm-preview")||assertScriptSupabaseAccess(process.env)!=="preview")throw new Error("Preview-only confirmation required");
const origin=`https://${PREVIEW_DB_PROJECT}.supabase.co`,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY??process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if(!key||key==="[SENSITIVE]")throw new Error("Preview public configuration required");
const topic=`mju-chat:${randomUUID()}`,results=[];
async function rejected(name,token){
  const client=new RealtimeClient(`${origin}/realtime/v1`,{params:{apikey:key}});
  try{
    await client.setAuth(token);
    const result=await new Promise(resolve=>{
      const timer=setTimeout(()=>resolve("unverified timeout"),12000);
      client.channel(topic,{config:{private:true}}).subscribe(status=>{
        if(["SUBSCRIBED","CHANNEL_ERROR"].includes(status)){clearTimeout(timer);resolve(status);}
      });
    });
    const passed=result==="CHANNEL_ERROR";results.push({name,passed,result});
  }catch{results.push({name,passed:false,result:"transport/setup error; not counted as authorization denial"});}
  finally{await client.disconnect();}
}
await rejected("anonymous private join",key);
const pair=await generateKeyPair("ES256",{extractable:true}),kid=randomUUID();
const publicJwk=await exportJWK(pair.publicKey);
const fake=await new SignJWT({role:"mju_chat_realtime",scope:"mju.chat.receive.v1",project:PREVIEW_DB_PROJECT,grant_id:randomUUID(),app_user_id:2147483647,room_id:2147483647,auth_sid:randomUUID()}).setProtectedHeader({alg:"ES256",kid,typ:"JWT",jwk:publicJwk}).setSubject(randomUUID()).setIssuer(origin+"/auth/v1").setAudience("mju-realtime").setIssuedAt().setExpirationTime("120s").sign(pair.privateKey);
await rejected("untrusted self-signed key / embedded JWK",fake);
// Server-side positive control only. This credential is never sent to a
// browser, returned, stored or used to sign a user token. The synthetic
// topic has no application user/room, so no existing conversation is joined.
const admin=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!admin||admin==="[SENSITIVE]")throw new Error("Preview server control credential required");
const channel=new RealtimeClient(`${origin}/realtime/v1`,{params:{apikey:key}});
try{
  await channel.setAuth(admin);
  const observed=new Set(),controlId=randomUUID(),forgedId=randomUUID(),legacyId=randomUUID();
  const receiver=channel.channel(topic,{config:{private:true}}).on("broadcast",{event:"message"},({payload})=>observed.add(payload.eventId));
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("Server control join unavailable")),15000);receiver.subscribe(status=>{if(status==="SUBSCRIBED"){clearTimeout(timer);resolve();}else if(status==="CHANNEL_ERROR"){clearTimeout(timer);reject(new Error("Server control join denied"));}});});
  // Batch REST intentionally returns 202 even when it silently drops an
  // unauthorized private message. HTTP status alone is not a denial proof.
  const r=await fetch(`${origin}/realtime/v1/api/broadcast`,{method:"POST",headers:{apikey:key,Authorization:`Bearer ${key}`,"content-type":"application/json"},body:JSON.stringify({messages:[{topic,event:"message",payload:{messageId:2147483647,eventId:legacyId},private:true}]}),redirect:"error",signal:AbortSignal.timeout(15000)});
  await r.body?.cancel();
  const modern=await fetch(`${origin}/realtime/v1/api/broadcast/${encodeURIComponent(topic)}/events/message?private=true`,{method:"POST",headers:{apikey:key,Authorization:`Bearer ${key}`,"content-type":"application/json"},body:JSON.stringify({messageId:2147483647,eventId:forgedId}),redirect:"error",signal:AbortSignal.timeout(15000)});
  await modern.body?.cancel();
  await receiver.httpSend("message",{messageId:2147483647,eventId:controlId},{timeout:10000});
  const deadline=Date.now()+10000;while(!observed.has(controlId)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
  await new Promise(r=>setTimeout(r,3000));
  results.push({name:"server control private delivery",passed:observed.has(controlId)});
  results.push({name:"anonymous batch private broadcast not delivered",passed:r.status===202&&observed.has(controlId)&&!observed.has(legacyId),status:r.status});
  results.push({name:"anonymous modern private broadcast denied",passed:[401,403].includes(modern.status)&&!observed.has(forgedId),status:modern.status});
}finally{await channel.disconnect();}
console.log(JSON.stringify({suite:"Preview private rejection probes",results,registeredMemberVerified:false}));
if(results.some(r=>!r.passed))process.exitCode=1;
