// GET /api/version -- which deployment answers on this host: its Vercel
// deployment id, environment and Git commit (Vercel's system environment
// variables). Public on purpose and nothing else: the repository is
// public, and 개발 통계 reads Production's answer to show the version that
// is actually live without a Vercel token. No database, no secrets.
// Cached at the edge for a minute.
export const dynamic = "force-dynamic";

export function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return Response.json(
    {
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      environment: process.env.VERCEL_ENV ?? null,
      gitSha: sha && /^[0-9a-f]{40}$/.test(sha) ? sha : null,
    },
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=60" } },
  );
}
