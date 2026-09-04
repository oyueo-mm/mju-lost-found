// This project's generator (`provider = "prisma-client"` in schema.prisma)
// writes the client to a custom `output` path instead of node_modules/
// .prisma -- so it's imported directly from there, not from the
// "@prisma/client" package.
import { PrismaClient } from "@/generated/prisma/client";
// Prisma 7's client requires a driver adapter (there is no more built-in
// URL-only connector); @prisma/adapter-mariadb is Prisma's adapter for
// both MySQL and MariaDB. It only opens a connection pool lazily, on the
// first query -- constructing it here is safe even with no real
// DATABASE_URL set yet (Phase 0-2 never run one).
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

const adapter = new PrismaMariaDb(process.env.DATABASE_URL ?? "");

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
