// Creates (or re-passwords) the cloud backup role backup_reader from the
// reviewed SQL (mju-find-backup db/backup-reader.sql) and writes its pooler
// connection string to .env.backup-<target>.local (gitignored) for the
// operator to paste into the GitHub Environment secret, then delete.
// Never prints the password or the connection string. Production only via the
// approved-operation launcher. Owner/app roles and their grants are untouched.
//
//   node --env-file=.env.preview.local scripts/operations/backup-reader-apply.mjs <backup-reader.sql>
//   node scripts/db/approved-operation.mjs --confirm-production --approval-reference <REF> -- scripts/operations/backup-reader-apply.mjs <backup-reader.sql>
// Rollback: db/backup-reader-drop.sql (same launcher), or revoke only the
// credential: ALTER ROLE backup_reader NOLOGIN PASSWORD NULL.
import "../db/install-guard.mjs";
import { Client } from "pg";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";

const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
const sqlFile = process.argv[2];
if (!sqlFile) throw new Error("usage: backup-reader-apply.mjs <backup-reader.sql>");
const sql = readFileSync(sqlFile, "utf8");
if (/\bPASSWORD\s+'/i.test(sql.replace(/--.*$/gm, ""))) throw new Error("the SQL file must not contain a password");
const ca = readFileSync(new URL("../../certs/supabase-prod-ca-2021.crt", import.meta.url), "utf8");
const owner = new URL(process.env.DIRECT_URL);
const db = new Client({ connectionString: process.env.DIRECT_URL, ssl: { ca, rejectUnauthorized: true } });
await db.connect();
try {
  await db.query("BEGIN");
  await db.query(sql);
  const password = randomBytes(30).toString("base64url");
  await db.query((await db.query("SELECT format('ALTER ROLE backup_reader PASSWORD %L', $1::text) AS s", [password])).rows[0].s);
  await db.query("COMMIT");
  const url = new URL(owner.href);
  url.username = owner.username.replace(/^postgres\./, "backup_reader.");
  url.password = password;
  url.search = "";
  const file = `.env.backup-${target}.local`;
  writeFileSync(file, `BACKUP_DATABASE_URL=${url.href}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ target, role: "backup_reader", applied: true, sqlSha256: createHash("sha256").update(sql).digest("hex").slice(0, 16), credentialFile: file }));
} catch (error) {
  await db.query("ROLLBACK").catch(() => {});
  throw new Error(`apply failed (${error.code ?? error.name}); rolled back`);
} finally {
  await db.end();
}
