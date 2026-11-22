// Read-only: does the local operations env file hold the SAME database URLs
// as the deployed Vercel environment? Pulls the Vercel env into a temporary
// file, compares SHA-256 hashes, deletes the file at once. Prints only
// match/no-match, URL parameter NAMES, host kind and port -- never values.
//
//   node scripts/operations/compare-vercel-db-env.mjs production .env.operations-production
//   node scripts/operations/compare-vercel-db-env.mjs preview .env.preview.local
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "dotenv";

const [environment, localFile] = process.argv.slice(2);
if (!["production", "preview"].includes(environment) || !localFile) throw new Error("usage: compare-vercel-db-env.mjs production|preview <local env file>");
const tmp = join(tmpdir(), `vercel-env-${randomUUID()}.env`);
try {
  const r = spawnSync(`npx --no-install vercel env pull "${tmp}" --environment=${environment} --yes`, { shell: true, encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error("vercel env pull failed");
  const remote = parse(readFileSync(tmp));
  const local = parse(readFileSync(localFile));
  const h = (v) => (v ? createHash("sha256").update(v).digest("hex").slice(0, 12) : null);
  const describe = (v) => { try { const u = new URL(v); return { host: u.hostname.replace(/^[a-z0-9]{20}\./, "<ref>."), port: u.port, params: [...u.searchParams.keys()] }; } catch { return null; } };
  const out = { environment };
  for (const k of ["DATABASE_URL", "DIRECT_URL", "PGSSLMODE", "PGSSLROOTCERT"]) {
    out[k] = { inVercel: k in remote, sameAsLocal: h(remote[k]) === h(local[k]), vercel: k.endsWith("URL") ? describe(remote[k]) : remote[k] ?? null };
  }
  console.log(JSON.stringify(out, null, 1));
} finally {
  rmSync(tmp, { force: true });
}
