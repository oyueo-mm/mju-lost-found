import { beforeAll, expect, it } from "vitest";
import { exportJWK, generateKeyPair, jwtVerify } from "jose";
import { realtimeProject, signRealtimeGrant, signingConfiguration, REALTIME_ROLE } from "./realtimeToken";
let env: NodeJS.ProcessEnv, publicKey: Awaited<ReturnType<typeof generateKeyPair>>["publicKey"];
const id="b4c4033b-c716-4a55-875b-ad526474ce44", sid="c98a3c0a-92d8-4856-a4ab-998d185190ab", now=Math.floor(Date.now()/1000);
beforeAll(async()=>{
  const pair=await generateKeyPair("ES256",{extractable:true});publicKey=pair.publicKey;
  env={NODE_ENV:"test",NEXT_PUBLIC_SUPABASE_URL:"https://swqvlihgupranzfzjevb.supabase.co",VERCEL_ENV:"preview",MJU_REALTIME_PRIVATE_JWK:JSON.stringify({...await exportJWK(pair.privateKey),kid:id,alg:"ES256"})};
});
it("signs a room/session scoped receive-only ES256 grant with a short expiry",async()=>{
  const token=await signRealtimeGrant({id,userId:7,roomId:10,sessionId:sid,expiresAt:new Date((now+120)*1000)},env,now);
  const {payload,protectedHeader}=await jwtVerify(token,publicKey,{algorithms:["ES256"],issuer:"https://swqvlihgupranzfzjevb.supabase.co/auth/v1",audience:"mju-realtime"});
  expect(protectedHeader).toEqual({alg:"ES256",kid:id,typ:"JWT"});
  expect(payload).toMatchObject({role:REALTIME_ROLE,app_user_id:7,room_id:10,grant_id:id,auth_sid:sid,exp:now+120,scope:"mju.chat.receive.v1"});
  expect(payload).not.toHaveProperty("email");expect(token).not.toContain("service_role");
});
it("rejects missing/invalid signing keys without falling back to Auth.js secrets",()=>{
  expect(()=>signingConfiguration({...env,MJU_REALTIME_PRIVATE_JWK:undefined,AUTH_SECRET:"existing-session-secret"})).toThrow("unavailable");
  expect(()=>signingConfiguration({...env,MJU_REALTIME_PRIVATE_JWK:JSON.stringify({kty:"oct",k:"anything"})})).toThrow("unavailable");
});
it("rejects mixed Preview/Production environment configuration",()=>{
  expect(()=>realtimeProject({...env,VERCEL_ENV:"production"})).toThrow("unavailable");
});
it("rejects overlong grants and caps caller-controlled roles/claims",async()=>{
  await expect(signRealtimeGrant({id,userId:7,roomId:10,sessionId:sid,expiresAt:new Date((now+121)*1000)},env,now)).rejects.toThrow("unavailable");
  await expect(signRealtimeGrant({id,userId:7,roomId:10,sessionId:sid,expiresAt:new Date(now*1000)},env,now)).rejects.toThrow("unavailable");
});
it("does not validate altered signatures or a different project's issuer",async()=>{
  const token=await signRealtimeGrant({id,userId:7,roomId:10,sessionId:sid,expiresAt:new Date((now+60)*1000)},env,now);
  const parts=token.split(".");parts[1]=Buffer.from(JSON.stringify({role:"service_role",exp:now+60})).toString("base64url");
  await expect(jwtVerify(parts.join("."),publicKey,{algorithms:["ES256"]})).rejects.toThrow();
  await expect(jwtVerify(token,publicKey,{issuer:"https://tmifqtyxojtuoejxjrng.supabase.co/auth/v1"})).rejects.toThrow();
});
it("rejects expired grants even when the signature remains valid",async()=>{
  const token=await signRealtimeGrant({id,userId:7,roomId:10,sessionId:sid,expiresAt:new Date((now+60)*1000)},env,now);
  await expect(jwtVerify(token,publicKey,{algorithms:["ES256"],currentDate:new Date((now+61)*1000)})).rejects.toThrow();
  const otherProject=await generateKeyPair("ES256");
  await expect(jwtVerify(token,otherProject.publicKey,{algorithms:["ES256"]})).rejects.toThrow();
});
