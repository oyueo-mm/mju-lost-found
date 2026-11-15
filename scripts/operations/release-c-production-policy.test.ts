import { describe, expect, it } from "vitest";
import { checkReleaseCMigrations } from "./release-c-production-policy.mjs";
const release = "20261121000000_report_snapshot";
const old = { migration_name: "old", applied: true, rolled_back: false, checksum: "old" };
describe("release C production migration scope", () => {
  it("allows only the single reviewed migration or an already applied identical one", () => {
    expect(checkReleaseCMigrations(["old", release], [old], "hash")).toEqual([release]);
    expect(checkReleaseCMigrations(["old", release], [old, { ...old, migration_name: release, checksum: "hash" }], "hash")).toEqual([]);
  });
  it("refuses other pending migrations, unfinished history, missing local history, and a changed checksum", () => {
    expect(() => checkReleaseCMigrations(["old", release, "new"], [old], "hash")).toThrow();
    expect(() => checkReleaseCMigrations(["old", release], [{ ...old, applied: false }], "hash")).toThrow();
    expect(() => checkReleaseCMigrations([release], [old], "hash")).toThrow();
    expect(() => checkReleaseCMigrations(["old", release], [old, { ...old, migration_name: release, checksum: "changed" }], "hash")).toThrow();
  });
});
