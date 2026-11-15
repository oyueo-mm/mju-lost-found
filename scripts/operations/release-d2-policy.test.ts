import { expect, it } from "vitest";
import { checkD2Migrations, D2_MIGRATIONS, LEGACY_DRAIN_SECONDS, PREVIEW_HISTORICAL_MIGRATIONS } from "./release-d2-policy.mjs";
const local = Object.fromEntries(["base", ...D2_MIGRATIONS].map(name => [name, ["checksum"]]));
const row = (migration_name = "base") => ({ migration_name, checksum: "checksum", applied: true, rolled_back: false });
it("admits only the approved D2 migrations", () => {
  expect(checkD2Migrations(local, [row()])).toEqual(D2_MIGRATIONS);
  expect(checkD2Migrations(local, Object.keys(local).map(row))).toEqual([]);
});
it("refuses incomplete, unknown and altered migration history", () => {
  expect(() => checkD2Migrations(local, [{ ...row(), applied: false }])).toThrow("Unfinished");
  expect(() => checkD2Migrations(local, [row("unknown")])).toThrow("absent");
  expect(() => checkD2Migrations(local, [{ ...row(), checksum: "changed" }])).toThrow("checksum");
  expect(() => checkD2Migrations({ ...local, unrelated: ["x"] }, [row()])).toThrow("Only D2");
});
it("keeps the legacy drain longer than all Hobby Fluid functions", () => {
  expect(LEGACY_DRAIN_SECONDS).toBeGreaterThan(300);
});
it("checks the documented Preview-only historical SQL exactly without applying it", () => {
  const [name, hashes]=Object.entries(PREVIEW_HISTORICAL_MIGRATIONS)[0];
  const archived={...row(name),checksum:hashes[0]};
  expect(checkD2Migrations(local,[row(),archived],PREVIEW_HISTORICAL_MIGRATIONS)).toEqual(D2_MIGRATIONS);
  expect(() => checkD2Migrations(local,[row(),archived])).toThrow("absent");
  expect(() => checkD2Migrations(local,[row(),{...archived,checksum:"changed"}],PREVIEW_HISTORICAL_MIGRATIONS)).toThrow("checksum");
});
