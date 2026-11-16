// Server only. Never import from a client component or use AUTH_SECRET here.
import { importJWK, SignJWT, type JWK } from "jose";
import { PREVIEW_DB_PROJECT, PRODUCTION_DB_PROJECT } from "@/lib/db/accessPolicy.mjs";

export const REALTIME_ROLE = "mju_chat_realtime";
export const REALTIME_TOKEN_SECONDS = 120;
export const REALTIME_SCOPE = "mju.chat.receive.v1";
export const REALTIME_AUDIENCE = "mju-realtime";
export const realtimeTopic = (grantId: string) => `mju-chat:${grantId}`;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class RealtimeSigningUnavailable extends Error {
  constructor() { super("Realtime signing configuration unavailable"); this.name = "RealtimeSigningUnavailable"; }
}

export function realtimeProject(env: NodeJS.ProcessEnv = process.env): string {
  try {
    const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error();
    const ref = url.hostname.split(".")[0];
    if (![PREVIEW_DB_PROJECT, PRODUCTION_DB_PROJECT].includes(ref) || url.hostname !== `${ref}.supabase.co`) throw new Error();
    if (env.VERCEL_ENV === "production" && ref !== PRODUCTION_DB_PROJECT || env.VERCEL_ENV === "preview" && ref !== PREVIEW_DB_PROJECT) throw new Error();
    return ref;
  } catch { throw new RealtimeSigningUnavailable(); }
}

export function signingConfiguration(env: NodeJS.ProcessEnv = process.env) {
  try {
    const project = realtimeProject(env);
    const key = JSON.parse(env.MJU_REALTIME_PRIVATE_JWK ?? "null") as JWK | null;
    if (!key || key.kty !== "EC" || key.crv !== "P-256" || !key.d || !key.x || !key.y || !UUID_PATTERN.test(key.kid ?? "") || key.alg !== "ES256") throw new Error();
    if ([key.d, key.x, key.y].some(s => !/^[A-Za-z0-9_-]{43}$/.test(s!))) throw new Error();
    return { project, kid: key.kid!, key };
  } catch { throw new RealtimeSigningUnavailable(); }
}

export type RealtimeGrantIdentity = { id: string; userId: number; roomId: number; sessionId: string; expiresAt: Date };
export async function signRealtimeGrant(grant: RealtimeGrantIdentity, env: NodeJS.ProcessEnv = process.env, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const {project, kid, key} = signingConfiguration(env);
  const exp = Math.floor(grant.expiresAt.getTime() / 1000);
  if (!UUID_PATTERN.test(grant.id) || !UUID_PATTERN.test(grant.sessionId) || !Number.isSafeInteger(grant.userId) || grant.userId < 1 || !Number.isSafeInteger(grant.roomId) || grant.roomId < 1 || exp <= now || exp > now + REALTIME_TOKEN_SECONDS) throw new RealtimeSigningUnavailable();
  try {
    return await new SignJWT({role: REALTIME_ROLE, scope: REALTIME_SCOPE, project, app_user_id: grant.userId, room_id: grant.roomId, grant_id: grant.id, auth_sid: grant.sessionId})
      .setProtectedHeader({alg: "ES256", kid, typ: "JWT"})
      .setSubject(grant.id).setIssuer(`https://${project}.supabase.co/auth/v1`).setAudience(REALTIME_AUDIENCE)
      .setJti(crypto.randomUUID()).setIssuedAt(now).setNotBefore(now - 5).setExpirationTime(exp)
      .sign(await importJWK(key, "ES256"));
  } catch { throw new RealtimeSigningUnavailable(); }
}
