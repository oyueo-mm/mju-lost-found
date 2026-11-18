// Hosted transport check. No application room, grant, JWT issuance, or data write.
import "../db/install-guard.mjs";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { RealtimeClient } from "@supabase/realtime-js";
import { createClient } from "@supabase/supabase-js";
import { assertScriptSupabaseAccess, PREVIEW_DB_PROJECT, PRODUCTION_DB_PROJECT } from "../../src/lib/db/accessPolicy.mjs";

const [confirmation, ...extra] = process.argv.slice(2);
const target = assertScriptSupabaseAccess(process.env);
if (extra.length || !["preview", "production"].includes(target) || confirmation !== `--confirm-${target}`) {
  throw new Error("Explicit hosted target required");
}

const origin = `https://${target === "production" ? PRODUCTION_DB_PROJECT : PREVIEW_DB_PROJECT}.supabase.co`;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serverKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if ([publicKey, serverKey].some(key => !key || key === "[SENSITIVE]")) throw new Error("Hosted credentials unavailable");

const topic = `mju-d3-transport-control:${randomUUID()}`;
const event = "transport_control";
const nonce = randomUUID();
const anonymous = new RealtimeClient(`${origin}/realtime/v1`, { params: { apikey: publicKey } });
const server = createClient(origin, serverKey, { auth: { persistSession: false, autoRefreshToken: false } });

function join(channel) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve("timeout"), 12000);
    channel.subscribe((status, error) => {
      clearTimeout(timer);
      if (status === "SUBSCRIBED") return resolve("subscribed");
      const reason = error?.message ?? "";
      if (status === "CHANNEL_ERROR" && /privateonly|private channels only/i.test(reason)) return resolve("private_only");
      if (status === "CHANNEL_ERROR" && /unauthorized|not authorized|do not have permissions?|permission denied/i.test(reason)) return resolve("authorization_denied");
      resolve("unverified");
    });
  });
}

const result = { target, anonymousPrivate: "unverified", anonymousPublic: "unverified", serverPrivate: "unverified", matchingEventReceived: false };
try {
  const privateChannel = anonymous.channel(topic, { config: { private: true } });
  result.anonymousPrivate = await join(privateChannel);
  await anonymous.removeChannel(privateChannel);
  result.anonymousPublic = await join(anonymous.channel(`${topic}:public`));

  const privateReceiver = server.channel(topic, { config: { private: true } })
    .on("broadcast", { event }, ({ payload }) => { if (payload?.nonce === nonce) result.matchingEventReceived = true; });
  result.serverPrivate = await join(privateReceiver);
  if (result.serverPrivate === "subscribed") {
    await privateReceiver.httpSend(event, { nonce }, { timeout: 5000 });
    const deadline = performance.now() + 5000;
    while (!result.matchingEventReceived && performance.now() < deadline) await delay(50);
  }
} catch {
  console.error("Realtime transport control stopped; diagnostics suppressed");
  process.exitCode = 1;
} finally {
  await Promise.allSettled([anonymous.disconnect(), server.realtime.disconnect()]);
  console.log(JSON.stringify(result));
}

if (result.anonymousPrivate !== "authorization_denied" || !["subscribed", "private_only"].includes(result.anonymousPublic) || !result.matchingEventReceived) {
  process.exitCode = 1;
}
