// Shared by Next, Prisma CLI and operational scripts. Never include a URL in errors.
export const PRODUCTION_DB_PROJECT = "tmifqtyxojtuoejxjrng";
export const PREVIEW_DB_PROJECT = "swqvlihgupranzfzjevb";
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const denied = (reason) => { throw new Error(`[db-access] ${reason}`); };

/** @param {string | undefined} value */
export function databaseTarget(value) {
  if (!value) return "missing";
  let url;
  try { url = new URL(value); } catch { return "unknown"; }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) return "unknown";
  if (localHosts.has(url.hostname)) return "local";
  const direct = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(url.hostname)?.[1];
  const pooler = /(^|\.)pooler\.supabase\.com$/.test(url.hostname)
    ? /^postgres\.([a-z0-9]+)$/.exec(decodeURIComponent(url.username))?.[1] : null;
  const project = direct ?? pooler;
  return project === PRODUCTION_DB_PROJECT ? "production" : project === PREVIEW_DB_PROJECT ? "preview" : "unknown";
}

/** @param {Record<string, string | undefined>} env */
export function databaseContext(env) {
  if (env.NODE_ENV === "test" || env.VITEST) return "test";
  if (env.VERCEL === "1" && env.NODE_ENV === "production" && env.VERCEL_ENV === "production") return "production";
  if (env.VERCEL_ENV === "preview") return "preview";
  return "development";
}

/**
 * @param {string | undefined} value
 * @param {Record<string, string | undefined>} env
 * @param {{usage?: "application" | "operation", allowMissing?: boolean}} options
 */
export function assertDatabaseAccess(value, env = process.env, options = {}) {
  const target = databaseTarget(value);
  const context = databaseContext(env);
  if (target === "missing" && options.allowMissing) return target;
  if (target === "missing") return denied("Database configuration is required; no fallback is permitted.");
  if (context === "test") return denied("Unit tests cannot open database connections. Use mocks.");
  if (target === "unknown") return denied("Unrecognized database target; connection refused.");
  if (options.usage === "operation") {
    if (target === "production" && !(env.MJU_DB_OPERATION === "approved" && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{2,159}$/.test(env.MJU_DB_APPROVAL_REFERENCE ?? ""))) {
      return denied("Production operations require the approved-operation launcher and an approval reference.");
    }
  } else if (context === "production") {
    if (target !== "production") return denied("Production runtime must use the Production database.");
  } else if (target === "production") {
    return denied("Production database access is blocked outside the Production runtime.");
  }
  if (context === "preview" && target !== "preview") return denied("Preview must use the Preview database.");
  return target;
}

/** @param {Record<string, string | undefined>} env @param {{usage?: "application" | "operation", allowMissing?: boolean}} options */
export function assertDatabaseEnvironment(env = process.env, options = {}) {
  const main = assertDatabaseAccess(env.DATABASE_URL, env, options);
  if (env.DIRECT_URL) {
    const direct = assertDatabaseAccess(env.DIRECT_URL, env, options);
    if (main !== "missing" && main !== direct) denied("DATABASE_URL and DIRECT_URL identify different environments.");
  }
  return main;
}

/** Guard scripts using Supabase REST/Storage instead of the PostgreSQL driver.
 * @param {Record<string, string | undefined>} env
 */
export function assertScriptSupabaseAccess(env = process.env) {
  let project;
  try { project = /^([a-z0-9]+)\.supabase\.co$/.exec(new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname)?.[1]; } catch { /* refused below */ }
  if (!project) return denied("Unrecognized Supabase target; operation refused.");
  return assertDatabaseAccess(`postgresql://postgres@db.${project}.supabase.co/postgres`, env, { usage: "operation" });
}
