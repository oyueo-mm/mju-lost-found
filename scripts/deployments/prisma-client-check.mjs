// Deploy gate for the generated Prisma client (see prismaClientCheck.mjs).
//
//   node scripts/deployments/prisma-client-check.mjs client
//       generated client == this checkout's schema. No database.
//   node --env-file=.env.preview.local scripts/deployments/prisma-client-check.mjs database
//   node scripts/db/approved-operation.mjs --confirm-production --approval-reference <REF> -- scripts/deployments/prisma-client-check.mjs database
//       the above, plus: every table/column/enum value the client uses exists in
//       the connected database. Metadata only (information_schema, pg_enum),
//       inside BEGIN READ ONLY, verified TLS. Prints names and counts, never rows.
// Exit 0 only when every check passes.
import "../db/install-guard.mjs";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clientMatchesSchemaFile } from "./prismaClientSchema.mjs";
import { databaseCompatibility, parseEnums, readGeneratedClient } from "./prismaClientCheck.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const mode = process.argv[2];
if (!["client", "database"].includes(mode)) throw new Error("usage: prisma-client-check.mjs client|database");

const client = readGeneratedClient(ROOT);
const schema = clientMatchesSchemaFile(ROOT, client.inlineSchema, { spawnSync, copyFileSync, mkdtempSync, readFileSync, rmSync, tmpdir });
const result = { clientMatchesCheckoutSchema: schema };
let ok = schema.ok;

if (mode === "database") {
  const { assertDatabaseEnvironment } = await import("../../src/lib/db/accessPolicy.mjs");
  const { pgConfig } = await import("../db/pgConfig.mjs");
  const { Client } = await import("pg");
  result.target = assertDatabaseEnvironment(process.env, { usage: "operation" });
  const db = new Client(pgConfig(process.env.DIRECT_URL, { connectionTimeoutMillis: 15000 }));
  await db.connect();
  try {
    await db.query("BEGIN READ ONLY");
    const columns = (await db.query(`
      SELECT table_name AS "table", column_name AS "column", is_nullable = 'YES' AS nullable,
             (column_default IS NOT NULL OR is_identity = 'YES' OR is_generated = 'ALWAYS') AS "hasDefault"
        FROM information_schema.columns WHERE table_schema = 'public'`)).rows;
    const enums = (await db.query(`
      SELECT t.typname AS type, e.enumlabel AS label
        FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'public'`)).rows;
    await db.query("ROLLBACK");
    result.database = databaseCompatibility({ dataModel: client.dataModel, enums: parseEnums(client.inlineSchema) }, { columns, enums });
    ok = ok && result.database.ok;
  } finally {
    await db.end();
  }
}
result.passed = ok;
console.log(JSON.stringify(result, null, 1));
process.exitCode = ok ? 0 : 1;
