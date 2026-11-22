// Function Storage C-2: read-only fingerprint of every stored text (and image)
// vector, to prove a release changed none of them. Prints counts and md5
// digests only. Compare two runs: digests must be identical.
//   node --env-file=.env.preview.local scripts/operations/text-vector-snapshot.mjs
import "../db/install-guard.mjs";
import { Client } from "pg";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";
import { pgConfig } from "../db/pgConfig.mjs";

if (process.argv.length !== 2) throw new Error("No arguments accepted");
const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
const db = new Client(pgConfig(process.env.DIRECT_URL, { connectionTimeoutMillis: 15000 }));
try {
  await db.connect();
  await db.query("BEGIN READ ONLY");
  const out = {};
  for (const [kind, table] of [["lost", '"LostPost"'], ["found", '"FoundPost"']]) {
    out[kind] = (await db.query(`SELECT count(*)::int AS posts,count(embedding)::int AS text_vectors,count("imageEmbedding")::int AS image_vectors,
        md5(coalesce(string_agg(id::text||':'||coalesce(embedding::text,'-'),'|' ORDER BY id),'')) AS text_digest,
        md5(coalesce(string_agg(id::text||':'||coalesce("imageEmbedding"::text,'-'),'|' ORDER BY id),'')) AS image_digest
      FROM ${table}`)).rows[0];
  }
  await db.query("ROLLBACK");
  console.log(JSON.stringify({ target, at: new Date().toISOString(), ...out }));
} finally {
  await db.end().catch(() => {});
}
