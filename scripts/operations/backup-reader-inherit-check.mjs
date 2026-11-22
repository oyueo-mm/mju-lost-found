// Preview only: a table created later by the owner role (as migrations do)
// is readable -- and only readable -- by backup_reader. Creates one empty
// probe table and drops it in the same transaction (rolled back).
//   node --env-file=.env.preview.local scripts/operations/backup-reader-inherit-check.mjs
import "../db/install-guard.mjs";
import { Client } from "pg";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";
if (assertDatabaseEnvironment(process.env, { usage: "operation" }) !== "preview") throw new Error("Preview only");
const db = new Client({ connectionString: process.env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  await db.query("BEGIN");
  await db.query(`CREATE TABLE public."BackupReaderInheritProbe"(id serial PRIMARY KEY)`);
  const r = (await db.query(`SELECT has_table_privilege('backup_reader','public."BackupReaderInheritProbe"','SELECT') AS sel,
    has_table_privilege('backup_reader','public."BackupReaderInheritProbe"','INSERT,UPDATE,DELETE,TRUNCATE') AS write,
    has_sequence_privilege('backup_reader','public."BackupReaderInheritProbe_id_seq"','SELECT') AS seq_select,
    has_sequence_privilege('backup_reader','public."BackupReaderInheritProbe_id_seq"','USAGE,UPDATE') AS seq_use`)).rows[0];
  await db.query("ROLLBACK");
  console.log(JSON.stringify({ target: "preview", newTable: r, rolledBack: true }));
} finally { await db.end(); }
