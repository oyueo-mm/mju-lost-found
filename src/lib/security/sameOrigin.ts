// CSRF defense in depth (security audit 2026-11-21, P-2): state-changing API
// requests must come from this site's own pages. The session cookie is
// SameSite=Lax, which already keeps it off cross-site POST/fetch; this check
// is the second layer, so a cookie-setting change or a browser exception
// cannot reopen the routes.
//
// Algorithm (same shape as Go 1.25 http.CrossOriginProtection):
//   1. GET/HEAD/OPTIONS are never rejected (they must not change state --
//      see the chat read split, P-3).
//   2. Sec-Fetch-Site present (every current browser): only "same-origin"
//      (or "none": typed by the user, never a script) passes.
//   3. No Sec-Fetch-Site: an Origin header must equal this request's own
//      origin. "null" (sandboxed/opaque) is refused.
//   4. Neither header: not a browser (server-to-server: the embedding kick,
//      Vercel cron, vercel curl). Browsers always send Origin on a
//      cross-origin unsafe request, so CSRF cannot arrive this way. Such a
//      request still needs its own credentials (session cookie or bearer).
// "Own origin" is the scheme of the request URL plus the Host header the
// browser used (next start's request.url host can differ locally; on Vercel
// Host is the domain the page was served from).
import { NextResponse } from "next/server";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const HOST = /^[A-Za-z0-9.-]+(:\d{1,5})?$/;

type RequestLike = { method?: string; url?: string; headers?: Headers };

export type CrossOriginVerdict = { ok: true } | { ok: false; reason: "sec-fetch-site" | "origin" | "null-origin" };

export function requestOrigin(request: RequestLike): string | null {
  if (!request.url) return null;
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  const host = request.headers?.get("host");
  return host && HOST.test(host) ? `${url.protocol}//${host.toLowerCase()}` : url.origin;
}

export function checkCrossOrigin(request: RequestLike): CrossOriginVerdict {
  const method = (request.method ?? "GET").toUpperCase();
  if (SAFE_METHODS.has(method)) return { ok: true };
  const headers = request.headers;
  if (!headers) return { ok: true };
  const site = headers.get("sec-fetch-site");
  if (site !== null) {
    return site === "same-origin" || site === "none" ? { ok: true } : { ok: false, reason: "sec-fetch-site" };
  }
  const origin = headers.get("origin");
  if (origin === null) return { ok: true };
  if (origin === "null") return { ok: false, reason: "null-origin" };
  const own = requestOrigin(request);
  return own !== null && origin.toLowerCase() === own ? { ok: true } : { ok: false, reason: "origin" };
}

/** 403 for a cross-origin state-changing request, otherwise null. */
export function crossOriginRejection(request: RequestLike): NextResponse | null {
  const verdict = checkCrossOrigin(request);
  if (verdict.ok) return null;
  // Method and reason only: never the path, ids, cookies or the foreign origin.
  console.warn("cross-origin request refused", JSON.stringify({ method: request.method, reason: verdict.reason }));
  return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403, headers: { "Cache-Control": "no-store" } });
}
