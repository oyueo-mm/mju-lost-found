// D-4: which CSP mode a deployment is built with, and whether the live
// deployment really carries it. Pure functions so deploy.mjs's guard is
// unit-tested (cspMode.test.ts).
//
// Production (since 2026-11-21 Report-Only is LIVE): --csp-mode is REQUIRED.
// Leaving it out used to build a deployment with no CSP at all, silently
// switching Report-Only off. Now:
//   --csp-mode=report-only           the current Production mode
//   --csp-mode=enforce               also needs --confirm-csp-enforce (separate approval)
//   --csp-mode=off                   also needs --allow-csp-off (deliberate rollback of CSP)
// Preview: optional, default off (as before).

export const CSP_MODES = ["report-only", "enforce", "off"];

/**
 * @param {"preview" | "production"} target
 * @param {string[]} args the CLI options after the target
 * @returns {{ ok: true, mode: "report-only" | "enforce" | "off" } | { ok: false, error: string }}
 */
export function resolveCspMode(target, args) {
  const flags = args.filter((a) => a.startsWith("--csp-mode="));
  if (flags.length > 1) return { ok: false, error: "--csp-mode는 한 번만 지정하세요." };
  const raw = flags[0]?.slice("--csp-mode=".length);
  if (raw !== undefined && !CSP_MODES.includes(raw)) return { ok: false, error: "--csp-mode=report-only|enforce|off" };
  if (target !== "production") return { ok: true, mode: /** @type {any} */ (raw ?? "off") };
  if (raw === undefined) {
    return { ok: false, error: "Production 배포는 --csp-mode를 반드시 지정해야 합니다. 현재 Production은 --csp-mode=report-only입니다(빠뜨리면 CSP가 꺼진 배포가 됩니다)." };
  }
  if (raw === "enforce" && !args.includes("--confirm-csp-enforce")) {
    return { ok: false, error: "CSP enforce는 별도 승인 대상입니다. 승인을 받았다면 --confirm-csp-enforce를 함께 지정하세요." };
  }
  if (raw === "off" && !args.includes("--allow-csp-off")) {
    return { ok: false, error: "Production CSP를 끄려면 --allow-csp-off를 함께 지정하세요(의도한 경우만)." };
  }
  return { ok: true, mode: /** @type {any} */ (raw) };
}

/**
 * The CSP mode a response's headers show.
 * @param {Headers | Record<string, string>} headers
 * @returns {"report-only" | "enforce" | "both" | "off"}
 */
export function cspModeFromHeaders(headers) {
  const get = (name) => (typeof headers.get === "function" ? headers.get(name) : headers[name] ?? headers[name.toLowerCase()]);
  const enforce = Boolean(get("content-security-policy"));
  const report = Boolean(get("content-security-policy-report-only"));
  if (enforce && report) return "both";
  return enforce ? "enforce" : report ? "report-only" : "off";
}

/**
 * Header names from raw `curl -sI` output (lower-cased) -> value map.
 * @param {string} text
 */
export function parseHeaderBlock(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0 && !/^HTTP\//i.test(line)) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}
