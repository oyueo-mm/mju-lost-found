// Read-only: the daily capacity snapshots the 03:00 cron records
// (MetricDaily capacity.db_mb / capacity.storage_mb) for the last N days.
// Numbers only -- no rows, names or object paths.
//
//   node --env-file=.env.preview.local scripts/operations/capacity-status.mjs [days]
//   node scripts/db/approved-operation.mjs --confirm-production --approval-reference <REF> -- scripts/operations/capacity-status.mjs [days]
import "../db/install-guard.mjs";
import { Client } from "pg";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";
import { pgConfig } from "../db/pgConfig.mjs";

const days = Number(process.argv[2] ?? 45);
if (!Number.isInteger(days) || days < 1 || days > 400) throw new Error("days must be 1..400");
const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
const db = new Client(pgConfig(process.env.DIRECT_URL, { connectionTimeoutMillis: 15000 }));
try {
  await db.connect();
  await db.query("BEGIN READ ONLY");
  const rows = (await db.query(
    `SELECT to_char(day,'YYYY-MM-DD') AS day, metric, value FROM "MetricDaily"
      WHERE metric IN ('capacity.db_mb','capacity.storage_mb') AND day >= current_date - $1::int ORDER BY day, metric`, [days])).rows;
  await db.query("ROLLBACK");
  const byDay = {};
  for (const r of rows) (byDay[r.day] ??= {})[r.metric.slice(9)] = Number(r.value);
  console.log(JSON.stringify({ target, readOnly: true, days, snapshots: byDay }));
} catch (error) {
  await db.query("ROLLBACK").catch(() => {});
  console.error("capacity read failed:", error.code ?? error.name);
  process.exitCode = 1;
} finally {
  await db.end();
}
