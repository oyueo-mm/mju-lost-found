// Read-only: does the app's real driver path (Prisma's PrismaPg adapter ->
// pg.Pool) actually apply src/lib/db/tls.ts? A successful query alone proves
// nothing, because the Supabase pooler also accepts plaintext. So:
//   1. app settings, with the CA swapped for an unrelated public root CA
//      -> the adapter MUST fail with a certificate error (the ssl options are
//         really used, and there is no fallback to plaintext);
//   2. app settings unchanged -> the adapter connects and `SELECT 1` works.
// Runs `SELECT 1` only. Prints outcomes and error codes, never credentials.
//
//   node --env-file=.env.preview.local scripts/operations/db-tls-adapter-check.mjs
import "../db/install-guard.mjs";
import tls from "node:tls";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";

const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
const { createJiti } = await import("jiti");
const { pgPoolSettings, SUPABASE_ROOT_CA_2021 } = await createJiti(import.meta.url).import("../../src/lib/db/tls.ts");

async function attempt(name, settings) {
  const adapter = new PrismaPg(settings);
  let driver;
  try {
    driver = await adapter.connect();
    const r = await driver.queryRaw({ sql: "SELECT 1 AS ok", args: [], argTypes: [] });
    return { name, connected: true, rows: r.rows.length };
  } catch (error) {
    const code = error?.cause?.originalCode ?? error?.cause?.code ?? error?.code ?? error?.cause?.message ?? error?.message;
    return { name, connected: false, error: String(code).slice(0, 80) };
  } finally {
    await driver?.dispose?.().catch(() => {});
  }
}

const results = [];
for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
  const cs = process.env[key];
  if (!cs) continue;
  const app = pgPoolSettings(cs);
  const unrelatedCa = tls.rootCertificates.find((pem) => pem !== SUPABASE_ROOT_CA_2021);
  const wrong = await attempt(`${key}: app settings with an unrelated CA`, { ...app, ssl: { ...app.ssl, ca: unrelatedCa } });
  const right = await attempt(`${key}: app settings`, app);
  wrong.expected = "refused"; wrong.ok = !wrong.connected;
  right.expected = "connected"; right.ok = right.connected;
  results.push(wrong, right);
}
const passed = results.length > 0 && results.every((r) => r.ok);
console.log(JSON.stringify({ target, passed, results }, null, 1));
process.exitCode = passed ? 0 : 1;
