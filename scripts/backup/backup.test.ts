import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The standing approval (scripts/db/approvalPolicy.mjs) pre-approves this
// script because it only READS Production. Keep it that way: any write
// statement, Storage mutation or session-level setting fails this test and
// must go through a reviewed one-off approval instead.
const source = readFileSync("scripts/backup/backup.mjs", "utf8");
const code = source.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

describe("scripts/backup/backup.mjs stays read-only", () => {
  it("sends only SELECT / BEGIN READ ONLY / COMMIT to the database", () => {
    const statements = [...code.matchAll(/db\.query\(\s*[`"']([^`"']*)/g)].map((m) => m[1].trim());
    expect(statements.length).toBeGreaterThanOrEqual(4);
    for (const sql of statements) expect(sql, sql).toMatch(/^(SELECT\b|BEGIN READ ONLY$|COMMIT$)/i);
    expect(code).not.toMatch(/SET\s+SESSION/i);
    expect(code).toContain('db.query("BEGIN READ ONLY")');
  });

  it("only lists and downloads Storage objects", () => {
    const objectCalls = [...code.matchAll(/storage\.from\([^)]*\)\s*\.(\w+)\(/g)].map((m) => m[1]);
    const bucketCalls = [...code.matchAll(/storage\.(?!from\b)(\w+)\(/g)].map((m) => m[1]);
    expect(objectCalls.length).toBeGreaterThan(0);
    for (const call of objectCalls) expect(["list", "download"]).toContain(call);
    for (const call of bucketCalls) expect(["listBuckets"]).toContain(call);
  });

  it("dumps with pg_dump/pg_restore --list only (no restore into the source) and keeps the connection guard", () => {
    const tools = [...code.matchAll(/run\("(\w+)"/g)].map((m) => m[1]);
    expect(new Set(tools)).toEqual(new Set(["pg_dump", "pg_restore"]));
    expect(code).toMatch(/run\("pg_restore", \["--list"/);
    expect(source).toContain('import "../db/install-guard.mjs"');
    expect(code).toContain('assertDatabaseAccess(url, process.env, { usage: "operation" })');
  });
});
