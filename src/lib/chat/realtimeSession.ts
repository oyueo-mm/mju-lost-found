import { prisma } from "@/lib/db/prisma";
import { UUID_PATTERN } from "./realtimeToken";

// Called by Auth.js signOut; does not import Auth.js (avoid a callback cycle).
export async function revokeChatRealtimeSession(token: { userId?: number; realtimeSessionId?: string; exp?: number } | null): Promise<void> {
  if (!token?.userId || !UUID_PATTERN.test(token.realtimeSessionId ?? "")) return;
  const expiry = new Date(Math.max(Date.now(), (token.exp ?? 0) * 1000));
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`INSERT INTO "ChatRealtimeSession"(id,user_id,expires_at,revoked_at) VALUES(${token.realtimeSessionId}::uuid,${token.userId},${expiry},(now() AT TIME ZONE 'UTC')) ON CONFLICT(id) DO UPDATE SET revoked_at=(now() AT TIME ZONE 'UTC') WHERE "ChatRealtimeSession".user_id=${token.userId}`;
    await tx.$executeRaw`UPDATE "ChatRealtimeGrant" SET revoked_at=(now() AT TIME ZONE 'UTC') WHERE session_id=${token.realtimeSessionId}::uuid AND user_id=${token.userId}`;
  });
}
