// Read-only: is the app's database connection actually encrypted?
//
// Connects exactly the way the app does -- `new pg.Client({ connectionString })`
// with the app's own pg package and no ssl option (src/lib/db/prisma.ts passes
// only the connection string to PrismaPg) -- and inspects the socket after the
// handshake: a TLS socket reports `encrypted` and its protocol. Runs `SELECT 1`
// only. Prints host kind, port, the NAMES of URL parameters, socket facts and
// the server certificate's issuer/subject (public) -- never credentials.
//
//   node --env-file=.env.preview.local scripts/operations/db-tls-status.mjs [--ca <pem file>]
//   node scripts/db/approved-operation.mjs --confirm-production --approval-reference <REF> -- scripts/operations/db-tls-status.mjs [--ca <pem>]
import "../db/install-guard.mjs";
import pg from "pg";
import tls from "node:tls";
import { readFileSync } from "node:fs";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";

const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
const caIndex = process.argv.indexOf("--ca");
const ca = caIndex > 0 ? readFileSync(process.argv[caIndex + 1], "utf8") : null;

async function probe(name, connectionString, ssl) {
  const url = new URL(connectionString);
  const client = new pg.Client(ssl === undefined ? { connectionString } : { connectionString, ssl });
  const out = { name, mode: ssl === undefined ? "as the app connects" : ssl.ca ? "TLS + CA verification" : "TLS forced", host: url.hostname.replace(/^[a-z0-9]{20}\./, "<ref>."), port: url.port, urlParams: [...url.searchParams.keys()] };
  try {
    await client.connect();
    await client.query("SELECT 1");
    const s = client.connection.stream;
    out.connected = true;
    out.encrypted = s instanceof tls.TLSSocket && s.encrypted === true;
    if (out.encrypted) {
      out.protocol = s.getProtocol();
      out.cipher = s.getCipher()?.name;
      out.authorized = s.authorized;
      const cert = s.getPeerCertificate(true);
      out.serverCert = { subjectCN: cert?.subject?.CN?.replace(/^[a-z0-9]{20}\./, "<ref>."), issuer: cert?.issuer?.CN, issuerO: cert?.issuer?.O, validTo: cert?.valid_to };
    }
  } catch (error) {
    out.connected = false;
    out.error = error.code ?? error.message.slice(0, 80);
  } finally {
    await client.end().catch(() => {});
  }
  return out;
}

// The app's own settings (src/lib/db/tls.ts) -- what deployments now use.
const { createJiti } = await import("jiti");
const jiti = createJiti(import.meta.url);
const { pgPoolSettings } = await jiti.import("../../src/lib/db/tls.ts");
const results = [];
for (const name of ["DATABASE_URL", "DIRECT_URL"]) {
  const cs = process.env[name];
  if (!cs) continue;
  results.push(await probe(name, cs, undefined));
  results.push(await probe(name, cs, { rejectUnauthorized: false }));
  if (ca) results.push(await probe(name, cs, { ca, rejectUnauthorized: true }));
  const app = pgPoolSettings(cs);
  const r = await probe(name, app.connectionString, app.ssl);
  r.mode = "app settings (src/lib/db/tls.ts)";
  results.push(r);
}
console.log(JSON.stringify({ target, pgVersion: JSON.parse(readFileSync(new URL("../../node_modules/pg/package.json", import.meta.url))).version, PGSSLMODE: process.env.PGSSLMODE ?? null, results }, null, 1));
