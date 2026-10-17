import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// DB check scripts must make reads read-only per transaction (BEGIN READ
// ONLY ... COMMIT), never per session: on the Supabase transaction pooler
// (port 6543) a session setting stays on the pooled server connection and
// the deployed app then gets a read-only connection (2026-10-17, Preview).
const roots = ["scripts", "src"];
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return name === "generated" || name === "node_modules" ? [] : files(p);
    return /\.(m?[jt]sx?)$/.test(name) && !name.endsWith("dbReadOnly.test.ts") ? [p] : [];
  });

describe("DB scripts: no session-level settings", () => {
  it("nothing sets session characteristics or a session default", () => {
    const offenders = roots
      .flatMap((r) => files(r))
      .filter((f) => /SET\s+SESSION|default_transaction_read_only\s*=|SET\s+default_transaction/i.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
