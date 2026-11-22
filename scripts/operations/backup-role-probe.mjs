// Read-only probe for the cloud backup role design (2026-11-22): what the
// connecting role may do and which tables need BYPASSRLS. Counts/flags only.
//   node --env-file=.env.preview.local scripts/operations/backup-role-probe.mjs
import "../db/install-guard.mjs";
import { Client } from "pg";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";
import { pgConfig } from "../db/pgConfig.mjs";
const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
if (target !== "preview") throw new Error("Preview only");
const db = new Client(pgConfig(process.env.DIRECT_URL));
await db.connect();
try {
  await db.query("BEGIN READ ONLY");
  const one = async (q) => (await db.query(q)).rows;
  const me = await one(`SELECT current_user, r.rolsuper, r.rolcreaterole, r.rolbypassrls, r.rolinherit FROM pg_roles r WHERE r.rolname=current_user`);
  const version = await one(`SELECT current_setting('server_version') v`);
  const rls = await one(`SELECT count(*)::int n FROM pg_tables WHERE schemaname='public' AND rowsecurity`);
  const storageGrant = await one(`SELECT has_table_privilege('storage.objects','SELECT WITH GRANT OPTION') objects_grant, has_table_privilege('storage.buckets','SELECT WITH GRANT OPTION') buckets_grant`);
  const existing = await one(`SELECT count(*)::int n FROM pg_roles WHERE rolname='backup_reader'`);
  console.log(JSON.stringify({ target, me: me[0], version: version[0].v, publicRlsTables: rls[0].n, storageGrant: storageGrant[0], backupReaderExists: existing[0].n > 0 }));
  await db.query("ROLLBACK");
} finally { await db.end(); }
