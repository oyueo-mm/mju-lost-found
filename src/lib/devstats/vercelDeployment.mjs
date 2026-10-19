// A Vercel deployment as kept in DeploymentRecord, from the official REST
// API's deployment object (GET /v6/deployments, /v13/deployments/{id}).
// Plain ESM with JSDoc so both the app (lib/devstats/vercel.ts) and the
// deploy recorder run next to the CLI (scripts/deployments/record.mjs)
// read Vercel's answer the same way. Only what the dashboard shows is
// taken: never the creator, the commit author's e-mail or anything from
// the project's settings.

export const PROJECT_ID = "prj_zMYrrsw80l829lSjs2n2Ur6YV5eP";
export const TEAM_SLUG = "oyueo";
export const PROJECT_NAME = "mju-lost-found-vercel";
export const PRODUCTION_HOST = "mju-find.vercel.app";
export const PREVIEW_ALIAS = "mju-lost-found-preview.vercel.app";

const STATES = new Set(["READY", "ERROR", "CANCELED", "BUILDING", "QUEUED", "INITIALIZING", "DELETED"]);

/**
 * @typedef {{
 *   id: string;
 *   target: "production" | "preview";
 *   url: string | null;
 *   gitSha: string | null;
 *   gitMessage: string | null;
 *   gitDirty: boolean | null;
 *   state: string | null;
 *   createdAt: string | null;
 *   readyAt: string | null;
 * }} VercelDeploymentRow
 */

const iso = (/** @type {unknown} */ ms) => (typeof ms === "number" && ms > 0 ? new Date(ms).toISOString() : null);

/** First line of a commit message, at most 200 characters. */
export function firstLine(/** @type {unknown} */ message) {
  if (typeof message !== "string") return null;
  const line = message.split(/\r?\n/)[0].trim();
  return line ? line.slice(0, 200) : null;
}

/**
 * @param {Record<string, any>} d a deployment object from the Vercel API
 * @returns {VercelDeploymentRow | null}
 */
export function fromVercel(d) {
  const id = d?.uid ?? d?.id;
  if (typeof id !== "string" || !id.startsWith("dpl_")) return null;
  const meta = d.meta ?? {};
  const state = d.readyState ?? d.state;
  const sha = typeof meta.githubCommitSha === "string" && /^[0-9a-f]{40}$/.test(meta.githubCommitSha) ? meta.githubCommitSha : null;
  // `ready` is when the build finished; a failed or canceled build has no
  // ready time of its own in the list, so none is invented
  const finished = state === "READY" ? (d.ready ?? null) : null;
  return {
    id,
    target: d.target === "production" ? "production" : "preview",
    url: typeof d.url === "string" ? d.url : null,
    gitSha: sha,
    gitMessage: sha ? firstLine(meta.githubCommitMessage) : null,
    // the CLI sends "1" when the working tree had uncommitted changes; its
    // absence is not taken as proof of a clean tree
    gitDirty: meta.gitDirty === "1" || meta.gitDirty === true ? true : null,
    state: typeof state === "string" && STATES.has(state) ? state : null,
    createdAt: iso(d.createdAt ?? d.created),
    readyAt: iso(finished),
  };
}

/** The deployment's page in the Vercel dashboard. */
export const inspectorUrl = (/** @type {string} */ id) => `https://vercel.com/${TEAM_SLUG}/${PROJECT_NAME}/${id.replace(/^dpl_/, "")}`;
