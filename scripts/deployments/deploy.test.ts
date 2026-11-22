import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(__dirname, "deploy.mjs"), "utf8");
const at = (needle: string) => {
  const i = src.indexOf(needle);
  expect(i, needle).toBeGreaterThan(0);
  return i;
};

describe("deploy.mjs (stale Prisma client incident 2026-11-22)", () => {
  it("regenerates the client, checks it against the checkout schema and the target database, THEN uploads", () => {
    const generate = at("prisma generate --config prisma7.config.ts");
    const client = at('"scripts/deployments/prisma-client-check.mjs"), "client"]');
    const database = at('"scripts/deployments/prisma-client-check.mjs", "database"]');
    const upload = at('"vercel", "deploy"');
    expect(generate).toBeLessThan(client);
    expect(client).toBeLessThan(database);
    expect(database).toBeLessThan(upload);
    expect(src).toMatch(/if \(generate\.status !== 0\) \{[\s\S]{0,400}?process\.exit\(1\)/);
    expect(src).toMatch(/if \(checkClient\.status !== 0\) \{[\s\S]{0,400}?process\.exit\(1\)/);
    expect(src).toMatch(/if \(checkDb\.status !== 0\) \{[\s\S]{0,400}?process\.exit\(1\)/);
  });

  it("checks Production only through the approved launcher, with a required approval reference", () => {
    expect(src).toContain('"scripts/db/approved-operation.mjs"), "--confirm-production", "--approval-reference", approvalReference');
    expect(src).toMatch(/target === "production" && !\/.*\/\.test\(approvalReference/);
  });

  it("keeps the CSP mode check and reports when the domain does not serve the new deployment", () => {
    expect(src).toContain("cspModeFromHeaders");
    expect(src).toContain("https://mju-find.vercel.app/api/version");
  });
});
