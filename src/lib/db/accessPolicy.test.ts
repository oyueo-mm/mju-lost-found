import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { assertDatabaseAccess, assertDatabaseEnvironment, assertScriptSupabaseAccess, databaseContext, databaseTarget, PREVIEW_DB_PROJECT, PRODUCTION_DB_PROJECT } from "./accessPolicy.mjs";

const url = (ref: string) => `postgresql://postgres.${ref}:not-a-secret@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres`;
const production = url(PRODUCTION_DB_PROJECT), preview = url(PREVIEW_DB_PROJECT);
const cloud = { NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "production" };

describe("database access safety", () => {
  it("classifies actual endpoints, never project strings inside passwords or arbitrary hosts", () => {
    expect(databaseTarget(production)).toBe("production");
    expect(databaseTarget(`postgresql://postgres:secret@db.${PREVIEW_DB_PROJECT}.supabase.co/postgres`)).toBe("preview");
    expect(databaseTarget(`postgresql://x:${PRODUCTION_DB_PROJECT}@example.com/db`)).toBe("unknown");
    expect(databaseTarget(production.replace("pooler.supabase.com", "pooler.supabase.com.evil.example"))).toBe("unknown");
    expect(databaseTarget("postgresql://postgres@127.0.0.1:5432/test")).toBe("local");
    expect(databaseTarget(undefined)).toBe("missing");
  });
  it("blocks Production in local dev, local next start/build, Preview and unit tests", () => {
    for (const env of [{}, { NODE_ENV: "development" }, { NODE_ENV: "production" }, { VERCEL_ENV: "preview" }, { ...cloud, NODE_ENV: "test" }, { ...cloud, VITEST: "true" }]) {
      expect(() => assertDatabaseAccess(production, env)).toThrow("[db-access]");
    }
    expect(() => assertDatabaseAccess(production, { VERCEL_ENV: "production" })).toThrow();
  });
  it("permits only matching cloud environments and keeps local development on Preview/local", () => {
    expect(assertDatabaseAccess(production, cloud)).toBe("production");
    expect(() => assertDatabaseAccess(preview, cloud)).toThrow();
    expect(assertDatabaseAccess(preview, { VERCEL_ENV: "preview" })).toBe("preview");
    expect(assertDatabaseAccess(preview, { NODE_ENV: "development" })).toBe("preview");
    expect(() => assertDatabaseAccess("postgresql://x@localhost/test", { VERCEL_ENV: "preview" })).toThrow();
    expect(databaseContext({ NODE_ENV: "production" })).toBe("development");
  });
  it("does not fall back when missing, rejects mixed DBs and never reveals credentials", () => {
    expect(() => assertDatabaseAccess(undefined, {})).toThrow("no fallback");
    expect(assertDatabaseAccess(undefined, {}, { allowMissing: true })).toBe("missing");
    expect(() => assertDatabaseEnvironment({ DATABASE_URL: preview, DIRECT_URL: production })).toThrow();
    try { assertDatabaseAccess(production, {}); } catch (e) { expect(String(e)).not.toContain("not-a-secret"); expect(String(e)).not.toContain(PRODUCTION_DB_PROJECT); }
  });
  it("requires an explicit operation approval, which never bypasses app or unit-test restrictions", () => {
    const approved = { MJU_DB_OPERATION: "approved", MJU_DB_APPROVAL_REFERENCE: "CHANGE-123" };
    expect(() => assertDatabaseAccess(production, {}, { usage: "operation" })).toThrow("approval");
    expect(assertDatabaseAccess(production, approved, { usage: "operation" })).toBe("production");
    expect(() => assertDatabaseAccess(production, approved)).toThrow();
    expect(() => assertDatabaseAccess(production, { ...approved, NODE_ENV: "test" }, { usage: "operation" })).toThrow();
  });
  it("refuses real pg Client and Pool connection attempts before network access", () => {
    // Deliberately uses a fake password; no real credentials or server requests.
    for (const kind of ["Client", "Pool"]) {
      const code = `import pg from 'pg'; import './scripts/db/install-guard.mjs'; const c=new pg.${kind}({connectionString:${JSON.stringify(production)},connectionTimeoutMillis:100}); try {await c.connect();process.exit(9)}catch(e){if(!e.message.startsWith('[db-access]'))process.exit(8)}finally{await c.end()}`;
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: "test" }, encoding: "utf8", timeout: 10000 });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).not.toContain("not-a-secret");
    }
  });
  it("protects Supabase script targets and refuses launching an app as an approved operation", () => {
    expect(() => assertScriptSupabaseAccess({ NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_DB_PROJECT}.supabase.co` })).toThrow("approval");
    expect(assertScriptSupabaseAccess({ NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_DB_PROJECT}.supabase.co` })).toBe("preview");
    const result = spawnSync(process.execPath, ["scripts/db/approved-operation.mjs", "--confirm-production", "--approval-reference", "CHANGE-123", "--", "node_modules/next/dist/bin/next"], { encoding: "utf8", timeout: 10000 });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Only an explicit repository operations");
  });
  it("blocks direct Next config startup with a Production URL before a server starts", () => {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", "await import('./next.config.ts')"], { env: { ...process.env, NODE_ENV: "development", DATABASE_URL: production, DIRECT_URL: production, VITEST: "", VERCEL: "", VERCEL_ENV: "" }, encoding: "utf8", timeout: 10000 });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("[db-access]");
    expect(result.stderr).not.toContain("not-a-secret");
  });
  it("keeps every tracked direct pg script behind the connection guard", () => {
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
    for (const file of walk("scripts").filter(f => /\.(mjs|ts)$/.test(f) && !f.startsWith("scripts/db/"))) {
      const source = readFileSync(file, "utf8");
      if (/new (?:pg\.)?(?:Client|Pool)\(|require\(["']pg["']\)/.test(source)) expect(source, file).toContain("install-guard.mjs");
    }
  });
  it("refuses a hot-reload client cached under a different database configuration", async () => {
    const previousClient = Reflect.get(globalThis, "prisma");
    const previousUrl = Reflect.get(globalThis, "prismaConnectionString");
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VITEST", "");
    vi.stubEnv("DATABASE_URL", preview); vi.stubEnv("DIRECT_URL", preview);
    Reflect.set(globalThis, "prisma", {});
    Reflect.set(globalThis, "prismaConnectionString", production);
    try {
      vi.resetModules();
      await expect(import("./prisma")).rejects.toThrow("Cached database configuration changed");
    } finally {
      Reflect.set(globalThis, "prisma", previousClient);
      Reflect.set(globalThis, "prismaConnectionString", previousUrl);
      vi.unstubAllEnvs();
    }
  });
});
