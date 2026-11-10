// This project's generator (`provider = "prisma-client"` in schema.prisma)
// writes the client to a custom `output` path instead of node_modules/
// .prisma -- so it's imported directly from there, not from the
// "@prisma/client" package.
import { PrismaClient } from "@/generated/prisma/client";
// Prisma 7's client requires a driver adapter (there is no more built-in
// URL-only connector); @prisma/adapter-pg wraps `pg` (node-postgres), the
// standard driver for PostgreSQL -- Supabase's Postgres is what this
// project targets (see prisma/schema.prisma's datasource comment; Phase 3
// moved off an earlier, never-connected MySQL/MariaDB placeholder). It only
// opens a connection pool lazily, on the first query -- constructing it
// here is safe even with no real DATABASE_URL set yet.
import { PrismaPg } from "@prisma/adapter-pg";
import { assertDatabaseEnvironment } from "./accessPolicy.mjs";

// Validate before reusing a hot-reloaded, globally cached client as well.
assertDatabaseEnvironment(process.env, { allowMissing: true });

// A deliberately unreachable local address (rather than crashing at import time) lets
// build-time prerendering and any DATABASE_URL-less dev/test run at all
// -- the resulting failure still surfaces, just lazily, on the first real
// query (as a connection error from the pg driver), which is what
// src/app/(main)/lost|found/page.tsx's try/catch and the API routes'
// withErrorHandling() are there to catch. This warning only makes the
// *reason* for that failure obvious in server logs (never the value
// itself) instead of leaving ops to guess from the driver's downstream
// parse error.
if (!process.env.DATABASE_URL) {
  console.warn(
    "[prisma] DATABASE_URL is not set. Database queries will fail until it is configured (see .env.example).",
  );
}

// Use the pooled connection (Supabase's PgBouncer, typically port 6543)
// here -- this is the app's long-lived runtime pool, which is what
// benefits from pooling under serverless/Vercel. Prisma Migrate uses
// DIRECT_URL instead (see schema.prisma's datasource block); this file
// never touches DIRECT_URL, since only the CLI's migrate/db-push commands
// need the unpooled connection.
// Never let pg fall back to PGHOST/PGUSER when DATABASE_URL is absent.
const connectionString = process.env.DATABASE_URL || "postgresql://unconfigured@127.0.0.1:1/unconfigured";
const adapter = new PrismaPg(connectionString);

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaConnectionString: string | undefined;
};

if (globalForPrisma.prisma && globalForPrisma.prismaConnectionString !== connectionString) {
  throw new Error("[db-access] Cached database configuration changed. Restart the server before continuing.");
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaConnectionString = connectionString;
}
