// Which Production deployments may be rollback targets. Pure, unit tested;
// scripts/deployments/rollback.mjs enforces it before calling `vercel rollback`.
// (The Vercel dashboard's Instant Rollback cannot be blocked from here --
// docs/operations/db-tls-2026-11-22.md lists the same rules for people.)

/** Never roll back to these: id -> reason. */
export const FORBIDDEN_ROLLBACK_TARGETS = {
  dpl_HbJbyTZFYnLLmBzLt7Bb1QCboNue:
    "2026-11-22 TLS first deploy: uploaded a Prisma client generated on another branch (selects User.sessions_valid_after, absent on Production); logged-in requests failed",
};

// First commit whose app connects to the database with verified TLS.
export const FIRST_TLS_COMMIT = "0263e6263af7893c2124f83fa68589ca4fdd6a98";
// Flip to true in the same change that records Supabase "Enforce SSL" being
// switched on: from then on a deployment without the TLS code cannot reach the
// database at all, so it is not a valid rollback target.
export const SUPABASE_SSL_ENFORCED = false;

/**
 * @param {{ id: string, target: string | null, state: string | null, hasTlsCode: boolean | null }} d
 * @param {{ sslEnforced?: boolean }} [opts]
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkRollbackTarget(d, { sslEnforced = SUPABASE_SSL_ENFORCED } = {}) {
  if (!/^dpl_[A-Za-z0-9]+$/.test(d.id ?? "")) return { ok: false, reason: "unknown deployment id" };
  if (FORBIDDEN_ROLLBACK_TARGETS[d.id]) return { ok: false, reason: `forbidden: ${FORBIDDEN_ROLLBACK_TARGETS[d.id]}` };
  if (d.target !== "production") return { ok: false, reason: "not a production deployment" };
  if (d.state !== "READY") return { ok: false, reason: `deployment is ${d.state ?? "in an unknown state"}` };
  if (sslEnforced && d.hasTlsCode !== true) return { ok: false, reason: "Supabase Enforce SSL is on and this deployment predates the database TLS code (or it could not be confirmed)" };
  return { ok: true };
}
