// Read-only: what does P-5 add to a signed-in request? getCurrentUser() runs
// the revocation lookup (ChatRealtimeSession by primary key) IN PARALLEL with
// the admin-permission lookup it already made, so the added wall time is
// roughly max(both) - permissions. Measures, from this machine through the
// app's own TLS connection rule:
//   - round trips of each query alone, and of the two together in parallel;
//   - server-side execution time (EXPLAIN ANALYZE) of the revocation lookup.
// Uses random ids (no row matches); prints timings only.
//   node --env-file=.env.preview.local scripts/operations/p5-latency-check.mjs
import "../db/install-guard.mjs";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { pgConfig } from "../db/pgConfig.mjs";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";

const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
const pool = new pg.Pool({ ...pgConfig(process.env.DATABASE_URL, { connectionTimeoutMillis: 15000 }), max: 4 });
const REVOKED = `SELECT id FROM "ChatRealtimeSession" WHERE id = $1::uuid AND user_id = $2 AND revoked_at IS NOT NULL LIMIT 1`;
const GRANTS = `SELECT permission FROM "AdminPermissionGrant" WHERE user_id = $1`;
const N = 40;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return +s[Math.floor(s.length / 2)].toFixed(2); };
const time = async (fn) => { const t = performance.now(); await fn(); return performance.now() - t; };
try {
  for (let i = 0; i < 5; i++) await Promise.all([pool.query(REVOKED, [randomUUID(), 1]), pool.query(GRANTS, [1])]); // warm the pool
  const grantsOnly = [], revokedOnly = [], parallel = [];
  for (let i = 0; i < N; i++) {
    grantsOnly.push(await time(() => pool.query(GRANTS, [1])));
    revokedOnly.push(await time(() => pool.query(REVOKED, [randomUUID(), 1])));
    parallel.push(await time(() => Promise.all([pool.query(REVOKED, [randomUUID(), 1]), pool.query(GRANTS, [1])])));
  }
  const plan = (await pool.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${REVOKED.replace("$1::uuid", `'${randomUUID()}'::uuid`).replace("$2", "1")}`)).rows[0]["QUERY PLAN"][0];
  console.log(JSON.stringify({
    target, samples: N,
    medianMs: { permissionsOnly_before: median(grantsOnly), revocationOnly: median(revokedOnly), both_in_parallel_after: median(parallel) },
    addedWallMs: +(median(parallel) - median(grantsOnly)).toFixed(2),
    revocationServerExecutionMs: plan["Execution Time"], revocationPlan: plan.Plan["Node Type"] + (plan.Plan.Plans?.[0] ? ` > ${plan.Plan.Plans[0]["Node Type"]}${plan.Plan.Plans[0]["Index Name"] ? ` (${plan.Plan.Plans[0]["Index Name"]})` : ""}` : ""),
  }, null, 1));
} finally {
  await pool.end();
}
