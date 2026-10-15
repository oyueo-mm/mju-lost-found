"use server";

import { headers } from "next/headers";

import { addDailyCount, currentAudience } from "@/lib/metrics/record";
import { isBotUserAgent, isPageKind, isRefSource, MAX_EVENTS_PER_CALL, sanitizeUtm } from "@/lib/metrics/visits";

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
export async function recordVisitsAction(events: unknown): Promise<void> {
  try {
    if (!Array.isArray(events) || events.length === 0) return;
    if (isBotUserAgent((await headers()).get("user-agent"))) return;
    const audience = await currentAudience();

    for (const raw of events.slice(0, MAX_EVENTS_PER_CALL)) {
      if (typeof raw !== "object" || raw === null) continue;
      const event = raw as Record<string, unknown>;
      if (!isPageKind(event.kind)) continue;
      if (audience === "internal") {
        addDailyCount("visit.internal.pv");
        continue;
      }
      addDailyCount(`visit.pv.${audience}`);
      addDailyCount(`visit.page.${event.kind}.${audience}`);
      if (event.sessionStart !== true) continue;
      addDailyCount(`visit.session.${audience}`);
      addDailyCount(`visit.ref.${isRefSource(event.ref) ? event.ref : "other"}`);
      const utmSource = sanitizeUtm(typeof event.utmSource === "string" ? event.utmSource : null);
      const utmCampaign = sanitizeUtm(typeof event.utmCampaign === "string" ? event.utmCampaign : null);
      if (utmSource) addDailyCount(`visit.utm_source.${utmSource}`);
      if (utmCampaign) addDailyCount(`visit.utm_campaign.${utmCampaign}`);
    }
  } catch {
    // Statistics never fail a visit.
  }
}
