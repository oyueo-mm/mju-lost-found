// Function Storage C-2: read-only check that a post's STORED text vector is the
// model's vector for its CURRENT text (and not for an earlier text). Reads one
// post inside BEGIN READ ONLY, computes embeddings locally with the same model
// code (buildEmbeddingText + getEmbeddingProvider), prints cosines and max
// |diff| only -- no text is printed.
//   node scripts/db/approved-operation.mjs --confirm-production --approval-reference <REF> -- scripts/operations/text-vector-check.mjs --post=lost:<id> --previous-title=<title before the edit>
import "../db/install-guard.mjs";
import { Client } from "pg";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const match = /^(lost|found):([1-9]\d{0,9})$/.exec(arg("post") ?? "");
const previousTitle = arg("previous-title");
if (!match || !previousTitle) throw new Error("--post=lost:<id> and --previous-title=<title> required");
const [, kind, rawId] = match;
const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
const db = new Client({ connectionString: process.env.DIRECT_URL, connectionTimeoutMillis: 15000 });
let row;
try {
  await db.connect();
  await db.query("BEGIN READ ONLY");
  row = (await db.query(`SELECT title,description,category,location,embedding::text AS v FROM ${kind === "lost" ? '"LostPost"' : '"FoundPost"'} WHERE id=$1`, [Number(rawId)])).rows[0];
  await db.query("ROLLBACK");
} finally { await db.end().catch(() => {}); }
if (!row?.v) throw new Error("Post or text vector missing");
// The DB read is done. The app modules imported below must never see the
// operator's database credentials (Prisma refuses Production outside the
// runtime by design), so drop them before importing the model code.
for (const key of Object.keys(process.env)) if (/DATABASE_URL|DIRECT_URL|SUPABASE_SERVICE_ROLE_KEY/.test(key)) delete process.env[key];
const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } });
const { buildEmbeddingText, getEmbeddingProvider } = await jiti.import("../../src/lib/ai/embedding.ts");
const stored = JSON.parse(row.v);
const compare = (a, b) => { let d = 0, dot = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d = Math.max(d, Math.abs(a[i] - b[i])); dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; } return { cosine: dot / Math.sqrt(na * nb), maxAbsDiff: d }; };
const current = await getEmbeddingProvider().embed(buildEmbeddingText(row));
const previous = await getEmbeddingProvider().embed(buildEmbeddingText({ ...row, title: previousTitle }));
const result = {
  target, post: `${kind}:${rawId}`, dims: stored.length, titleChanged: previousTitle !== row.title,
  storedVsCurrentText: compare(stored, current),
  storedVsPreviousText: compare(stored, previous),
  currentVsPreviousText: compare(current, previous),
};
result.storedIsCurrent = result.storedVsCurrentText.cosine > result.storedVsPreviousText.cosine && result.storedVsCurrentText.cosine >= 0.9999;
console.log(JSON.stringify(result, null, 1));
if (!result.storedIsCurrent) process.exitCode = 1;
