// pg connection settings for operational scripts -- the SAME rule the app uses
// (src/lib/db/tls.ts): Supabase hosts always get TLS with Supabase's root CA
// and host-name verification (sslmode-style URL parameters cannot weaken it),
// local databases stay plain, anything else is passed through unchanged.
// Without this, pg's default is NO TLS: the connection would be plaintext
// today and refused once Supabase "Enforce SSL" is on.
//
//   import { pgConfig, libpqTlsEnv } from "../db/pgConfig.mjs";
//   new Client(pgConfig(process.env.DIRECT_URL, { connectionTimeoutMillis: 15000 }))
//   spawn("pg_dump", [url, ...], { env: { ...process.env, ...libpqTlsEnv(url) } })
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const { pgPoolSettings, isSupabaseHost } = await createJiti(import.meta.url).import("../../src/lib/db/tls.ts");

export const SUPABASE_CA_FILE = fileURLToPath(new URL("../../certs/supabase-prod-ca-2021.crt", import.meta.url));

/** pg Client/Pool options: `extra` (timeouts, ...) plus the TLS rule; the rule always wins. */
export function pgConfig(connectionString, extra = {}) {
  return { ...extra, ...pgPoolSettings(connectionString) };
}

/** Environment for libpq tools (pg_dump, pg_restore, psql): verify-full against the Supabase CA for Supabase hosts, nothing otherwise. */
export function libpqTlsEnv(connectionString) {
  let host;
  try { host = new URL(connectionString).hostname; } catch { return {}; }
  return isSupabaseHost(host) ? { PGSSLMODE: "verify-full", PGSSLROOTCERT: SUPABASE_CA_FILE } : {};
}
