import { prisma } from "@/lib/db/prisma";
import { firstLine, type VercelDeploymentRow } from "./vercelDeployment.mjs";

// 배포 이력 (DeploymentRecord): Vercel deployments kept in the database, so
// the history outlives Vercel's own retention. Three writers, one row per
// deployment id:
// - "runtime": the deployment itself, once per server start
//   (src/instrumentation.ts) -- its id, environment and Git commit from
//   Vercel's system environment variables, and when it first ran. No
//   polling and no API call.
// - "cli": scripts/deployments/record.mjs next to the Vercel CLI -- Vercel's
//   created / ready times and state (failed builds too), read with the
//   CLI's own login on the developer's machine.
// - "api": the dashboard and the daily cron, only when a Vercel API token
//   is configured (lib/devstats/vercel.ts).
// Each write only fills in what it knows; nothing is guessed or backfilled.

export type DeploymentSource = "runtime" | "cli" | "api";
export type DeploymentRecordRow = VercelDeploymentRow & {
  firstSeenAt: string | null;
  currentAt: string | null;
  sources: DeploymentSource[];
};
type Input = Partial<VercelDeploymentRow> & Pick<VercelDeploymentRow, "id" | "target"> & { firstSeenAt?: string | null; currentAt?: string | null };

const ts = (iso: string | null | undefined) => iso ?? null;

export async function upsertDeployment(row: Input, source: DeploymentSource): Promise<void> {
  // timestamp columns hold UTC wall time
  await prisma.$executeRaw`
    INSERT INTO "DeploymentRecord" AS d
      ("id", "target", "url", "git_sha", "git_message", "git_dirty", "state", "created_at", "ready_at", "first_seen_at", "current_at", "sources", "updated_at")
    VALUES (
      ${row.id}, ${row.target}, ${row.url ?? null}, ${row.gitSha ?? null}, ${row.gitMessage ?? null}, ${row.gitDirty ?? null}, ${row.state ?? null},
      (${ts(row.createdAt)}::timestamptz AT TIME ZONE 'UTC'), (${ts(row.readyAt)}::timestamptz AT TIME ZONE 'UTC'),
      (${ts(row.firstSeenAt)}::timestamptz AT TIME ZONE 'UTC'), (${ts(row.currentAt)}::timestamptz AT TIME ZONE 'UTC'),
      ARRAY[${source}]::text[], (now() AT TIME ZONE 'UTC'))
    ON CONFLICT ("id") DO UPDATE SET
      "target" = EXCLUDED."target",
      "url" = COALESCE(EXCLUDED."url", d."url"),
      "git_sha" = COALESCE(EXCLUDED."git_sha", d."git_sha"),
      "git_message" = COALESCE(EXCLUDED."git_message", d."git_message"),
      "git_dirty" = COALESCE(EXCLUDED."git_dirty", d."git_dirty"),
      "state" = COALESCE(EXCLUDED."state", d."state"),
      "created_at" = COALESCE(EXCLUDED."created_at", d."created_at"),
      "ready_at" = COALESCE(EXCLUDED."ready_at", d."ready_at"),
      "first_seen_at" = LEAST(d."first_seen_at", EXCLUDED."first_seen_at"),
      "current_at" = GREATEST(d."current_at", EXCLUDED."current_at"),
      "sources" = ARRAY(SELECT DISTINCT unnest(d."sources" || EXCLUDED."sources") ORDER BY 1),
      "updated_at" = EXCLUDED."updated_at"`;
}

// What Vercel tells the running deployment about itself (system
// environment variables). Local runs have no deployment id: nothing.
export function runtimeDeployment(env: Record<string, string | undefined> = process.env, now = new Date()): Input | null {
  const id = env.VERCEL_DEPLOYMENT_ID;
  if (!id || !id.startsWith("dpl_")) return null;
  if (env.VERCEL_ENV !== "production" && env.VERCEL_ENV !== "preview") return null;
  const sha = env.VERCEL_GIT_COMMIT_SHA && /^[0-9a-f]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA) ? env.VERCEL_GIT_COMMIT_SHA : null;
  return {
    id,
    target: env.VERCEL_ENV,
    url: env.VERCEL_URL ?? null,
    gitSha: sha,
    gitMessage: sha ? firstLine(env.VERCEL_GIT_COMMIT_MESSAGE) : null,
    // it is running, so its build finished; the time is the CLI's / API's to tell
    state: "READY",
    firstSeenAt: now.toISOString(),
  };
}

// Once per server start; a failure (no table yet, DB busy) is ignored.
export async function recordRuntimeDeployment(): Promise<void> {
  const row = runtimeDeployment();
  if (!row) return;
  try {
    await upsertDeployment(row, "runtime");
  } catch {
    // the history simply misses this start
  }
}

type DbRow = {
  id: string;
  target: string;
  url: string | null;
  git_sha: string | null;
  git_message: string | null;
  git_dirty: boolean | null;
  state: string | null;
  created_at: string | null;
  ready_at: string | null;
  first_seen_at: string | null;
  current_at: string | null;
  sources: string[] | null;
};
const asIso = (v: string | null) => (v ? `${v.replace(" ", "T")}Z` : null);

// Every recorded deployment, newest first. null: the table is missing or
// unreadable (shown as "수집 실패", never as "no deployments").
export async function loadDeploymentRecords(limit = 500): Promise<DeploymentRecordRow[] | null> {
  try {
    const rows = await prisma.$queryRaw<DbRow[]>`
      SELECT "id", "target", "url", "git_sha", "git_message", "git_dirty", "state",
             "created_at"::text, "ready_at"::text, "first_seen_at"::text, "current_at"::text, "sources"
      FROM "DeploymentRecord"
      ORDER BY COALESCE("created_at", "first_seen_at") DESC NULLS LAST
      LIMIT ${limit}`;
    return rows.map((r) => ({
      id: r.id,
      target: r.target === "production" ? "production" : "preview",
      url: r.url,
      gitSha: r.git_sha,
      gitMessage: r.git_message,
      gitDirty: r.git_dirty,
      state: r.state,
      createdAt: asIso(r.created_at),
      readyAt: asIso(r.ready_at),
      firstSeenAt: asIso(r.first_seen_at),
      currentAt: asIso(r.current_at),
      sources: (r.sources ?? []).filter((s): s is DeploymentSource => s === "runtime" || s === "cli" || s === "api"),
    }));
  } catch {
    return null;
  }
}
