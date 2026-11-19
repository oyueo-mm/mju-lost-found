import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import type { CurrentUser } from "@/lib/auth/session";
import { checkRateLimit, rateLimitTierFor, type RateLimitResult } from "@/lib/rateLimit";
import { realtimeTopic, signRealtimeGrant, signingConfiguration, REALTIME_TOKEN_SECONDS, UUID_PATTERN } from "./realtimeToken";

type Denied = { kind: "forbidden" | "unavailable" | "polling" } | { kind: "limited"; admission: Exclude<RateLimitResult,{ok:true}> };
type Issued = { kind:"ok"; token:string; topic:string; expiresAt:string; grantId:string };
export async function issueChatRealtimeGrant(user: CurrentUser, session: { id:string; expiresAt:number }, roomId: number): Promise<Issued|Denied> {
  if (!UUID_PATTERN.test(session.id) || !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= Math.floor(Date.now()/1000)) return {kind:"forbidden"};
  // Admission also covers polling/missing-key and unauthorized-room requests.
  // Do not perform a full room DTO lookup before limiting this endpoint.
  const admission=await checkRateLimit("realtimeToken",{userId:user.id,tier:await rateLimitTierFor(user)});
  if (!admission.ok) return {kind:"limited",admission};
  const member=(await prisma.$queryRaw<{allowed:boolean}[]>`SELECT public.mju_chat_member_allowed(${user.id},${roomId}) AS allowed`)[0]?.allowed;
  if(!member)return {kind:"forbidden"};
  const mode=(await prisma.$queryRaw<{mode:string;project_ref:string;signing_kid:string}[]>`SELECT mode,project_ref,signing_kid::text FROM "ChatRealtimeConfig" WHERE id=true`)[0];
  if(mode?.mode==="polling")return {kind:"polling"};
  let config;
  try { config=signingConfiguration(); } catch { return {kind:"unavailable"}; }
  if (mode?.mode!=="private" || mode.project_ref!==config.project || mode.signing_kid!==config.kid.toLowerCase()) return {kind:"unavailable"};
  const now=Math.floor(Date.now()/1000), expiresAt=new Date(Math.min(now+REALTIME_TOKEN_SECONDS,session.expiresAt)*1000);
  const grant=await prisma.$transaction(async tx=>{
    // Runtime transitions lock this singleton exclusively before revoking
    // grants. Hold the shared lock through admission so a concurrent insert
    // cannot escape a mode/key transition's revocation snapshot.
    const lockedMode=(await tx.$queryRaw<{mode:string;project_ref:string;signing_kid:string}[]>`SELECT mode,project_ref,signing_kid::text FROM "ChatRealtimeConfig" WHERE id=true FOR SHARE`)[0];
    if(lockedMode?.mode==="polling")return "polling" as const;
    if(lockedMode?.mode!=="private"||lockedMode.project_ref!==config.project||lockedMode.signing_kid!==config.kid.toLowerCase())return "unavailable" as const;
    // Serialize only transient grant admission; no content/user row mutations.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(184219,${user.id})`;
    const allowed=(await tx.$queryRaw<{allowed:boolean}[]>`SELECT public.mju_chat_member_allowed(${user.id},${roomId}) AS allowed`)[0]?.allowed;
    if (!allowed) return null;
    const parent=await tx.$queryRaw<{id:string}[]>`INSERT INTO "ChatRealtimeSession" AS s(id,user_id,expires_at) VALUES(${session.id}::uuid,${user.id},${new Date(session.expiresAt*1000)}) ON CONFLICT(id) DO UPDATE SET expires_at=GREATEST(s.expires_at,EXCLUDED.expires_at) WHERE s.user_id=EXCLUDED.user_id AND s.revoked_at IS NULL RETURNING id`;
    if (!parent.length) return null;
    // One topic per signed Auth.js session and room; multiple tabs share it.
    const existing=(await tx.$queryRaw<{id:string;active:boolean}[]>`SELECT id,(revoked_at IS NULL AND expires_at>(now() AT TIME ZONE 'UTC')) AS active FROM "ChatRealtimeGrant" WHERE session_id=${session.id}::uuid AND room_id=${roomId} AND client_id=${session.id}::uuid`)[0];
    if (!existing?.active) {
      const active=(await tx.$queryRaw<{n:number}[]>`SELECT count(*)::int AS n FROM "ChatRealtimeGrant" WHERE user_id=${user.id} AND room_id=${roomId} AND revoked_at IS NULL AND expires_at>(now() AT TIME ZONE 'UTC')`)[0]?.n??0;
      if (active>=10) return "capacity" as const;
    }
    return (await tx.$queryRaw<{id:string}[]>`INSERT INTO "ChatRealtimeGrant" AS g(id,user_id,session_id,room_id,client_id,expires_at) VALUES(${randomUUID()}::uuid,${user.id},${session.id}::uuid,${roomId},${session.id}::uuid,${expiresAt}) ON CONFLICT(session_id,room_id,client_id) DO UPDATE SET id=CASE WHEN g.revoked_at IS NOT NULL THEN EXCLUDED.id ELSE g.id END,expires_at=EXCLUDED.expires_at,revoked_at=NULL RETURNING id`)[0]??null;
  });
  if(grant==="unavailable"||grant==="polling")return {kind:grant};
  if(grant==="capacity")return {kind:"limited",admission:{ok:false,reason:"limited",retryAfterSeconds:120}};
  if(!grant)return {kind:"forbidden"};
  try {
    const token=await signRealtimeGrant({id:grant.id,userId:user.id,roomId,sessionId:session.id,expiresAt});
    return {kind:"ok",token,topic:realtimeTopic(grant.id),expiresAt:expiresAt.toISOString(),grantId:grant.id};
  } catch { return {kind:"unavailable"}; }
}

// RLS is cached on joined sockets. Re-authorize every outgoing event and send
// only to still-authorized per-grant topics, never to a shared room topic.
export async function currentChatRealtimeTopics(roomId:number):Promise<string[]> {
  const rows=await prisma.$queryRaw<{id:string}[]>`SELECT g.id FROM "ChatRealtimeGrant" g JOIN "ChatRealtimeSession" s ON s.id=g.session_id AND s.user_id=g.user_id JOIN "ChatRealtimeConfig" c ON c.id=true WHERE g.room_id=${roomId} AND c.mode='private' AND g.revoked_at IS NULL AND s.revoked_at IS NULL AND g.expires_at>(now() AT TIME ZONE 'UTC') AND s.expires_at>(now() AT TIME ZONE 'UTC') AND public.mju_chat_member_allowed(g.user_id,g.room_id)`;
  return rows.map(r=>realtimeTopic(r.id));
}

export async function withAuthorizedChatRealtimeTopic(roomId:number,topic:string,send:()=>Promise<void>):Promise<void>{
  const id=topic.slice("mju-chat:".length);if(!topic.startsWith("mju-chat:")||!UUID_PATTERN.test(id))return;
  await prisma.$transaction(async tx=>{
    const mode=(await tx.$queryRaw<{mode:string}[]>`SELECT mode FROM "ChatRealtimeConfig" WHERE id=true FOR SHARE`)[0];
    if(mode?.mode!=="private")return;
    // Same lock order as issuance/logout: session, then grant. Hold shared
    // locks only for a bounded HTTP send. Revocation commits after in-flight
    // sends finish, and no send can be newly admitted after that commit.
    await tx.$queryRaw`SELECT s.id FROM "ChatRealtimeSession" s WHERE s.id=(SELECT session_id FROM "ChatRealtimeGrant" WHERE id=${id}::uuid) FOR SHARE`;
    const allowed=await tx.$queryRaw<{id:string}[]>`SELECT g.id FROM "ChatRealtimeGrant" g JOIN "ChatRealtimeSession" s ON s.id=g.session_id AND s.user_id=g.user_id JOIN "ChatRealtimeConfig" c ON c.id=true WHERE g.id=${id}::uuid AND g.room_id=${roomId} AND c.mode='private' AND g.revoked_at IS NULL AND s.revoked_at IS NULL AND g.expires_at>(now() AT TIME ZONE 'UTC') AND s.expires_at>(now() AT TIME ZONE 'UTC') AND public.mju_chat_member_allowed(g.user_id,g.room_id) FOR SHARE OF g`;
    if(allowed.length)await send();
  },{maxWait:2000,timeout:5000});
}

export async function cleanExpiredChatRealtimeGrants():Promise<void>{
  // Separate commits avoid holding grant-delete locks while waiting for a
  // session being renewed (issuance always locks session before grant).
  await prisma.$executeRaw`DELETE FROM "ChatRealtimeGrant" WHERE expires_at<(now() AT TIME ZONE 'UTC')-interval '1 day'`;
  await prisma.$executeRaw`DELETE FROM "ChatRealtimeSession" WHERE expires_at<(now() AT TIME ZONE 'UTC') AND NOT EXISTS(SELECT 1 FROM "ChatRealtimeGrant" g WHERE g.session_id="ChatRealtimeSession".id)`;
}
