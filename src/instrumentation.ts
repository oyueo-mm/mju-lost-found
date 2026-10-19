// Runs once per server start. 배포 이력: a deployment records itself (id,
// environment, Git commit -- lib/devstats/deployments.ts) the first time it
// serves anything, so the history needs no polling and no Vercel token.
// Never during the build, never locally (no deployment id), at most a
// second of the start-up, and a failure is ignored.
const RECORD_TIMEOUT_MS = 1000;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (!process.env.VERCEL_DEPLOYMENT_ID) return;
  const { recordRuntimeDeployment } = await import("@/lib/devstats/deployments");
  await Promise.race([recordRuntimeDeployment(), new Promise((resolve) => setTimeout(resolve, RECORD_TIMEOUT_MS))]);
}
