import { NextResponse } from "next/server";

import { addDailyCount } from "@/lib/metrics/record";
import { checkRateLimit, rateLimitFailure, rateLimitFailureResponse, type RateLimitResult } from "./index";

// Security audit A-4 (2026-11-22): admission for AI search (semantic, image,
// ai and the semantic half of unified search), in this order:
//   1. the caller's own budget -- a member by id, an anonymous visitor by
//      network (IPv4 address / IPv6 /64);
//   2. anonymous only: one ceiling for all anonymous visitors together;
//   3. everyone: one ceiling for the whole service.
// A caller over its own budget is never charged to the shared ceilings, so
// one abuser cannot spend the service's budget alone. Members are never
// charged to the anonymous ceiling, so an anonymous flood cannot lock them
// out. Daily counters (MetricDaily ai_search.*) let an operator see volume
// and every refusal by scope without logging addresses or queries.
export type AiSearchScope = "member" | "anon";
export type AiSearchDenial = "self" | "anon_global" | "global";
export type AiSearchAdmission = { ok: true } | { ok: false; denial: AiSearchDenial; result: Exclude<RateLimitResult, { ok: true }> };

export async function admitAiSearch(user: { id: number } | null, ip: string | null): Promise<AiSearchAdmission> {
  const scope: AiSearchScope = user ? "member" : "anon";
  const steps: [AiSearchDenial, () => Promise<RateLimitResult>][] = [
    ["self", () => checkRateLimit("aiSearch", user ? { userId: user.id } : { ip })],
    ...(user ? [] : [["anon_global", () => checkRateLimit("aiSearchAnonymousGlobal", { global: true })] as [AiSearchDenial, () => Promise<RateLimitResult>]]),
    ["global", () => checkRateLimit("aiSearchGlobal", { global: true })],
  ];
  for (const [denial, check] of steps) {
    const result = await check();
    if (!result.ok) {
      addDailyCount(`ai_search.${result.reason === "unavailable" ? "unavailable" : "limited"}.${scope}.${denial}`);
      return { ok: false, denial, result };
    }
  }
  addDailyCount(`ai_search.admitted.${scope}`);
  return { ok: true };
}

const BUSY: Record<Exclude<AiSearchDenial, "self">, string> = {
  anon_global: "지금은 AI 검색 요청이 많아 로그인하지 않은 이용자의 AI 검색을 잠시 제한하고 있어요. 로그인하면 계속 이용할 수 있어요.",
  global: "지금은 AI 검색 요청이 많아 잠시 제한하고 있어요. 잠시 후 다시 시도해주세요.",
};

/** The response for a refused admission (429 over a limit, 503 when the counters are unreachable). */
export function aiSearchDenialResponse(admission: Exclude<AiSearchAdmission, { ok: true }>): NextResponse {
  const failure = rateLimitFailure(admission.result)!;
  if (admission.denial === "self" || failure.kind !== "rate_limited") return rateLimitFailureResponse(failure);
  return NextResponse.json(
    { error: BUSY[admission.denial], code: "AI_SEARCH_BUSY", retryAfterSeconds: failure.retryAfterSeconds, retryAt: new Date(Date.now() + failure.retryAfterSeconds * 1000).toISOString() },
    { status: 429, headers: { "Retry-After": String(failure.retryAfterSeconds), "Cache-Control": "no-store" } },
  );
}
