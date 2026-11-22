import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { libpqTlsEnv, pgConfig, SUPABASE_CA_FILE } from "./pgConfig.mjs";

const ROOT = join(__dirname, "..", "..");
// Scripts that only ever connect to a throwaway local PostgreSQL.
const LOCAL_ONLY = new Set([
  "scripts/backup/snapshot-integration.mjs",
  "scripts/backup/verify-restore.mjs",
  "scripts/regression/realtime-local.mjs",
  "scripts/regression/text-job-migration-local.mjs",
  "scripts/regression/web-push-device.mjs",
  // Diagnostic: deliberately connects the OLD way to measure whether that is plaintext.
  "scripts/operations/db-tls-status.mjs",
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "node_modules" ? [] : walk(p);
    return /\.(mjs|js|cjs)$/.test(name) ? [p] : [];
  });
}

describe("pgConfig (operational scripts follow the app's TLS rule)", () => {
  it("forces verified TLS for Supabase and keeps extra options", () => {
    const c = pgConfig("postgresql://postgres.abc@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=disable", { connectionTimeoutMillis: 15000, ssl: false });
    expect(c.connectionString).not.toContain("sslmode");
    expect(c.ssl).toMatchObject({ rejectUnauthorized: true });
    expect(c.connectionTimeoutMillis).toBe(15000);
  });

  it("leaves local databases plain", () => {
    expect(pgConfig("postgresql://postgres@127.0.0.1:55439/verify").ssl).toBe(false);
  });

  it("gives libpq tools verify-full with the pinned CA for Supabase only", () => {
    expect(libpqTlsEnv("postgresql://postgres.abc@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres")).toEqual({ PGSSLMODE: "verify-full", PGSSLROOTCERT: SUPABASE_CA_FILE });
    expect(readFileSync(SUPABASE_CA_FILE, "utf8")).toContain("BEGIN CERTIFICATE");
    expect(libpqTlsEnv("postgresql://postgres@127.0.0.1:55439/verify")).toEqual({});
  });

  it("every remote pg connection in scripts/ goes through pgConfig", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "scripts"))) {
      const rel = relative(ROOT, file).replaceAll("\\", "/");
      if (LOCAL_ONLY.has(rel) || rel.startsWith("scripts/db/")) continue;
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/new (?:pg\.)?(?:Client|Pool)\(([^)]{0,40})/g)) {
        if (!m[1].startsWith("pgConfig(") && !m[1].startsWith("{ ...pgConfig(")) offenders.push(`${rel}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
