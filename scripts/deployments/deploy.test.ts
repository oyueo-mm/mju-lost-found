import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(__dirname, "deploy.mjs"), "utf8");

describe("deploy.mjs", () => {
  it("regenerates the Prisma client from this checkout before uploading (stale client incident 2026-11-22)", () => {
    const generate = src.indexOf("prisma generate --config prisma7.config.ts");
    const deploy = src.indexOf('"vercel", "deploy"');
    expect(generate).toBeGreaterThan(0);
    expect(deploy).toBeGreaterThan(generate);
    expect(src).toMatch(/if \(generate\.status !== 0\) \{[^}]*process\.exit\(1\)/);
  });
});
