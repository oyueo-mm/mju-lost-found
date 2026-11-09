import { sanitizeCallbackUrl } from "@/lib/auth/callbackUrl";
import { sanitizeUtm } from "./visits";

const TAGS = ["utm_source", "utm_medium", "utm_campaign", "utm_content"] as const;
export const LANDING_HEADER = "x-mju-registration-return";

export function gateReturnPath(raw: string | null): string | undefined {
  const safe = sanitizeCallbackUrl(raw);
  if (!safe) return undefined;
  const url = new URL(safe, "https://mju-find.vercel.app");
  if (url.pathname === "/found/new" || url.pathname === "/lost/new") {
    return postLandingPath(url.pathname, Object.fromEntries(url.searchParams));
  }
  if (url.pathname === "/me/identity") {
    const callback = sanitizeCallbackUrl(url.searchParams.get("callbackUrl"));
    return callback ? `/me/identity?callbackUrl=${encodeURIComponent(callback)}` : "/me/identity";
  }
  return undefined;
}

// Protected pages redirect before rendering. Keep only the tags our counter
// accepts in their return path; no arbitrary query values are propagated.
export function postLandingPath(path: "/found/new" | "/lost/new", params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const tag of TAGS) {
    const value = params[tag];
    const clean = sanitizeUtm(typeof value === "string" ? value : null);
    if (clean) query.set(tag, clean);
  }
  if (typeof params.after === "string" && /^\d+$/.test(params.after)) query.set("after", params.after);
  return query.size ? `${path}?${query}` : path;
}

// The first rendered screen may be /login or /privacy-consent. Read its
// validated return path too, without creating another session or event.
export function landingTags(search: string): URLSearchParams {
  let params = new URLSearchParams(search);
  for (let depth = 0; depth < 4; depth++) {
    if (TAGS.some((tag) => sanitizeUtm(params.get(tag)))) return params;
    const callback = sanitizeCallbackUrl(params.get("callbackUrl"));
    if (!callback) break;
    params = new URLSearchParams(callback.split("?").slice(1).join("?").split("#")[0]);
  }
  return params;
}
