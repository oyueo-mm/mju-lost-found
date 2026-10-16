"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";

import { addDailyCount, currentAudience } from "@/lib/metrics/record";
import { flowCounterChanges, parseFlowUpdate } from "@/lib/metrics/flow";
import { deviceOf, isBotUserAgent, isPageKind, isRefSource, MAX_EVENTS_PER_CALL, sanitizeUtm } from "@/lib/metrics/visits";

// 방문 통계: page views from components/layout/VisitBeacon (real browser
// renders only -- a prefetch never runs it). A server action, not a new API
// route: the Hobby plan's function cap is used up (see next.config.ts).
// Every value is re-checked here against the fixed lists in
// lib/metrics/visits.ts; anything else is dropped. Only per-day counters
// are written (MetricDaily, batched after the response); nothing identifies
// the visitor.
//
// Counters (all "visit.*"):
//   pv.<aud>                    page views          aud = anon | member
//   page.<kind>.<aud>           page views by page kind
//   session.<aud>               visit sessions started
//   ref.<source>                sessions by referrer category
//   utm_source.<v>, utm_campaign.<v>   sessions with UTM tags
//   internal.pv                 admins' page views (kept out of the above)
//   device.<kind>.pv, device.<kind>.session   the same page views / sessions
//                               by device class (lib/metrics/visits.ts
//                               deviceOf) -- a split of pv / session, never
//                               added to them
//   start.hour.<HH>, start.page.<kind>   sessions by KST start hour / first
//                               screen (counted with session.<aud>)
//   flow.*                      방문 시간·이탈 (lib/metrics/flow.ts): each
//                               session's latest end screen, duration,
//                               page count and end hour, moved between
//                               buckets as the browser reports changes
//
// A browser opted out ("내 방문 통계에서 제외", on by default once an admin
// has signed in there) still sends its views with `optedOut`: signed in as
// an admin they count as internal.pv as before; otherwise (signed out, or a
// member account on that browser) they are dropped. The reply tells the
// beacon when the viewer is an admin, so it can turn the opt-out on.
//
// Abuse limits (per server instance, memory only): at most
// MAX_EVENTS_PER_MINUTE events per client per minute (the client is a
// truncated hash of the forwarded IP, never stored), and at most
// MAX_UTM_VALUES distinct UTM sources / campaigns a day -- later new values
// are counted as "etc". Every counter name is from a fixed list or one of
// those capped values, and all writes go through the existing batched
// write (one statement every 20 s at most), so no request pattern can
// multiply DB writes or grow the table without bound.
const MAX_EVENTS_PER_MINUTE = 60;
const MAX_UTM_VALUES = 30;
// A report carries at most the ending session and the current one.
const MAX_FLOW_UPDATES = 3;
const recentByClient = new Map<string, { start: number; count: number }>();
const utmSeen = new Map<string, Set<string>>();

function admit(client: string, wanted: number, now = Date.now()): number {
  let entry = recentByClient.get(client);
  if (!entry || now - entry.start > 60_000) {
    entry = { start: now, count: 0 };
    recentByClient.set(client, entry);
    if (recentByClient.size > 5000) {
      for (const [key, value] of recentByClient) if (now - value.start > 60_000) recentByClient.delete(key);
    }
  }
  const allowed = Math.max(0, Math.min(wanted, MAX_EVENTS_PER_MINUTE - entry.count));
  entry.count += allowed;
  return allowed;
}

function cappedUtm(kind: "source" | "campaign", value: string, day: string): string {
  const key = `${day}|${kind}`;
  let seen = utmSeen.get(key);
  if (!seen) {
    for (const k of utmSeen.keys()) if (!k.startsWith(day)) utmSeen.delete(k);
    seen = new Set();
    utmSeen.set(key, seen);
  }
  if (seen.has(value)) return value;
  if (seen.size >= MAX_UTM_VALUES) return "etc";
  seen.add(value);
  return value;
}

export async function recordVisitsAction(
  events: unknown,
  options?: { optedOut?: boolean; touch?: boolean; flow?: unknown },
): Promise<{ admin: boolean } | void> {
  try {
    if (!Array.isArray(events)) return;
    const flows = Array.isArray(options?.flow) ? options.flow.slice(0, MAX_FLOW_UPDATES) : [];
    if (events.length === 0 && flows.length === 0) return;
    const requestHeaders = await headers();
    if (isBotUserAgent(requestHeaders.get("user-agent"))) return;
    const ip = (requestHeaders.get("x-forwarded-for") ?? requestHeaders.get("x-real-ip") ?? "").split(",")[0].trim();
    const client = createHash("sha256").update(`visit-limit:${ip}`).digest("base64url").slice(0, 16);
    // A report without page views (the tab was backgrounded) costs one.
    const admitted = admit(client, Math.max(1, Math.min(events.length, MAX_EVENTS_PER_CALL)));
    if (admitted === 0) return;
    const audience = await currentAudience();
    if (audience !== "internal" && options?.optedOut === true) return { admin: false };
    const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const day = kstNow.toISOString().slice(0, 10);
    const device = deviceOf(requestHeaders.get("user-agent"), requestHeaders.get("sec-ch-ua-mobile"), options?.touch === true);

    for (const raw of events.slice(0, admitted)) {
      if (typeof raw !== "object" || raw === null) continue;
      const event = raw as Record<string, unknown>;
      if (!isPageKind(event.kind)) continue;
      if (audience === "internal") {
        addDailyCount("visit.internal.pv");
        continue;
      }
      addDailyCount(`visit.pv.${audience}`);
      addDailyCount(`visit.page.${event.kind}.${audience}`);
      addDailyCount(`visit.device.${device}.pv`);
      if (event.sessionStart !== true) continue;
      addDailyCount(`visit.session.${audience}`);
      addDailyCount(`visit.device.${device}.session`);
      addDailyCount(`visit.start.hour.${String(kstNow.getUTCHours()).padStart(2, "0")}`);
      addDailyCount(`visit.start.page.${event.kind}`);
      addDailyCount(`visit.ref.${isRefSource(event.ref) ? event.ref : "other"}`);
      const utmSource = sanitizeUtm(typeof event.utmSource === "string" ? event.utmSource : null);
      const utmCampaign = sanitizeUtm(typeof event.utmCampaign === "string" ? event.utmCampaign : null);
      if (utmSource) addDailyCount(`visit.utm_source.${cappedUtm("source", utmSource, day)}`);
      if (utmCampaign) addDailyCount(`visit.utm_campaign.${cappedUtm("campaign", utmCampaign, day)}`);
    }
    // 방문 시간·이탈: admins' sessions stay out, like their page views.
    if (audience !== "internal") {
      for (const raw of flows) {
        const update = parseFlowUpdate(raw, day);
        if (!update) continue;
        for (const [metric, n] of flowCounterChanges(update, device)) addDailyCount(metric, n, update.day);
      }
    }
    return { admin: audience === "internal" };
  } catch {
    // Statistics never fail a visit.
  }
}
