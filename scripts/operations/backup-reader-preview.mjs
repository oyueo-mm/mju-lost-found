// Creates (or re-passwords) the cloud backup role on the PREVIEW database only
// and writes its connection string to .env.backup-preview.local (gitignored).
// Never prints the password or the connection string.
//   node --env-file=.env.preview.local scripts/operations/backup-reader-preview.mjs <path to backup-reader.sql>
import "../db/install-guard.mjs";
import { Client } from "pg";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";
if (assertDatabaseEnvironment(process.env, { usage: "operation" }) !== "preview") throw new Error("Preview only");
const sqlFile = process.argv[2];
if (!sqlFile) throw new Error("usage: backup-reader-preview.mjs <backup-reader.sql>");
const owner = new URL(process.env.DIRECT_URL);
const db = new Client({ connectionString: process.env.DIRECT_URL });
await db.connect();
try {
  await db.query(readFileSync(sqlFile, "utf8"));
  const password = randomBytes(30).toString("base64url");
  const stmt = (await db.query("SELECT format('ALTER ROLE backup_reader PASSWORD %L', $1::text) AS s", [password])).rows[0].s;
  await db.query(stmt);
  const url = new URL(owner.href);
  url.username = owner.username.replace(/^postgres\./, "backup_reader.");
  url.password = password;
  writeFileSync(".env.backup-preview.local", `BACKUP_DATABASE_URL=${url.href}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ target: "preview", role: "backup_reader", applied: true, credentialFile: ".env.backup-preview.local" }));
} finally { await db.end(); }
