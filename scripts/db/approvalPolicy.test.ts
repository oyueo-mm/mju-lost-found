import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { checkApprovedLaunch, STANDING_BACKUP_REFERENCE } from "./approvalPolicy.mjs";
import { PRODUCTION_DB_PROJECT, PREVIEW_DB_PROJECT } from "../../src/lib/db/accessPolicy.mjs";

const root = resolve("C:/Users/someone/mju-lost-found-backups");
const backup = (outDir: string, expect = "tmifqt") => ({
  reference: STANDING_BACKUP_REFERENCE,
  scriptRelative: "backup\\backup.mjs",
  scriptArgs: [outDir, "--expect", expect],
  backupRoot: root,
});

describe("checkApprovedLaunch -- standing backup approval", () => {
  it("allows the scheduled backup into a dated folder directly under the backup root", () => {
    expect(checkApprovedLaunch(backup(join(root, "auto-2026-11-15")))).toBe("standing-backup");
    expect(checkApprovedLaunch(backup(join(root, "weekly-2026-11-15"), PRODUCTION_DB_PROJECT))).toBe("standing-backup");
    expect(checkApprovedLaunch({ ...backup(join(root, "auto-2026-11-15")), scriptRelative: "backup/backup.mjs" })).toBe("standing-backup");
  });

  it("refuses every other script with the standing reference", () => {
    for (const scriptRelative of ["deployments/record.mjs", "backup/verify-restore.mjs", "backup/seal.mjs", "ai-eval-seed/seed-demo.mjs", "backup/../deployments/record.mjs"]) {
      expect(() => checkApprovedLaunch({ ...backup(join(root, "auto-2026-11-15")), scriptRelative })).toThrow("backup.mjs only");
    }
  });

  it("refuses other references that claim to be standing", () => {
    for (const reference of ["DAILY-BACKUP-STANDING", "weekly-backup-standing", "WEEKLY-BACKUP-STANDING-2", "STANDING", "X-STANDING-Y"]) {
      expect(() => checkApprovedLaunch({ ...backup(join(root, "auto-2026-11-15")), reference })).toThrow("standing");
    }
  });

  it("refuses a different argument shape or a non-Production project", () => {
    const out = join(root, "auto-2026-11-15");
    expect(() => checkApprovedLaunch({ ...backup(out), scriptArgs: [out] })).toThrow("arguments");
    expect(() => checkApprovedLaunch({ ...backup(out), scriptArgs: [out, "--expect", "tmifqt", "--extra"] })).toThrow("arguments");
    expect(() => checkApprovedLaunch({ ...backup(out), scriptArgs: [out, "--other", "tmifqt"] })).toThrow("arguments");
    expect(() => checkApprovedLaunch(backup(out, PREVIEW_DB_PROJECT))).toThrow("Production");
    expect(() => checkApprovedLaunch(backup(out, "tmi"))).toThrow("Production");
  });

  it("refuses output folders outside the root, nested, traversing or wrongly named", () => {
    for (const outDir of [
      resolve("C:/Windows/Temp/auto-2026-11-15"),
      join(root, "sub", "auto-2026-11-15"),
      join(root, "..", "auto-2026-11-15"),
      join(root, "auto-2026-11-15", ".."),
      join(root, "production-2026-11-15"),
      join(root, "auto-latest"),
      "auto-2026-11-15",
    ]) {
      expect(() => checkApprovedLaunch(backup(outDir)), outDir).toThrow("[approved-operation]");
    }
  });

  it("leaves one-off references as they were (format checked only)", () => {
    expect(checkApprovedLaunch({ reference: "CHANGE-123", scriptRelative: "deployments/record.mjs", scriptArgs: ["--dry-run"], backupRoot: root })).toBe("one-off");
    expect(() => checkApprovedLaunch({ reference: undefined, scriptRelative: "deployments/record.mjs", scriptArgs: [], backupRoot: root })).toThrow("reference");
    expect(() => checkApprovedLaunch({ reference: "-x", scriptRelative: "deployments/record.mjs", scriptArgs: [], backupRoot: root })).toThrow("reference");
  });
});

describe("approved-operation.mjs launcher", () => {
  it("refuses another script under the standing reference before reading any credential", () => {
    const result = spawnSync(process.execPath, ["scripts/db/approved-operation.mjs", "--confirm-production", "--approval-reference", STANDING_BACKUP_REFERENCE, "--", "scripts/deployments/record.mjs", "--db", "production"], { encoding: "utf8", timeout: 10000 });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("backup.mjs only");
    expect(result.stderr).not.toContain("operations-production");
  });
});
