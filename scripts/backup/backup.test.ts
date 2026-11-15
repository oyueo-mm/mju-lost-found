import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The standing approval (scripts/db/approvalPolicy.mjs) pre-approves this
// script because it only READS Production. Keep it that way: any write
// statement, Storage mutation or session-level setting fails this test and
// must go through a reviewed one-off approval instead.
const source = readFileSync("scripts/backup/backup.mjs", "utf8");
const snapshot = readFileSync("scripts/backup/snapshot.mjs", "utf8");
const code = source.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

describe("scripts/backup/backup.mjs stays read-only", () => {
  it("sends only SELECT / BEGIN READ ONLY / COMMIT to the database", () => {
    const statements = [...(code + snapshot).matchAll(/(?:db|current)\.query\(\s*([`"'])([\s\S]*?)\1/g)].map((m) => m[2].trim());
    expect(statements.length).toBeGreaterThanOrEqual(4);
    for (const sql of statements) expect(sql, sql).toMatch(/^(SELECT\b|BEGIN READ ONLY$|BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY$|SET LOCAL idle_in_transaction_session_timeout = '5min'$|COMMIT$|ROLLBACK$)/i);
    expect(code).not.toMatch(/SET\s+SESSION/i);
    expect(snapshot).toContain('db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")');
    expect(snapshot).toContain('SELECT pg_export_snapshot() AS snapshot');
    expect(code.match(/"--snapshot", snapshot/g)).toHaveLength(3);
    expect(code).not.toContain("execFileSync");
    expect(snapshot).toContain('db.query("ROLLBACK")');
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
