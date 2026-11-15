// Which (approval reference, script, arguments) combinations the Production
// launcher (approved-operation.mjs) accepts. Pure functions, unit tested.
//
// A normal reference (CHANGE-123 ...) is a one-off approval given by the
// operator for a reviewed operation; the launcher only checks its format.
//
// The standing reference below is pre-approved for ONE thing only: the
// scheduled, read-only Production backup (scripts/backup/backup.mjs runs
// pg_dump, row counts inside BEGIN READ ONLY, and Storage list/download --
// see backup.test.ts). With it the launcher refuses any other script, any
// other argument shape, an output folder outside the backup root, and any
// other reference that claims to be "standing".
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

import { PRODUCTION_DB_PROJECT } from "../../src/lib/db/accessPolicy.mjs";

export const APPROVAL_REFERENCE_FORMAT = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{2,159}$/;
export const STANDING_BACKUP_REFERENCE = "WEEKLY-BACKUP-STANDING";
export const STANDING_BACKUP_SCRIPT = "backup/backup.mjs"; // relative to scripts/
export const STANDING_BACKUP_NAME = /^(auto|weekly)-\d{4}-\d{2}-\d{2}$/;
export const defaultBackupRoot = () => resolve(homedir(), "mju-lost-found-backups");

const refuse = (reason) => {
  throw new Error(`[approved-operation] ${reason}`);
};

/**
 * @param {{ reference: string | undefined, scriptRelative: string, scriptArgs: string[], backupRoot?: string }} launch
 * @returns {"one-off" | "standing-backup"}
 */
export function checkApprovedLaunch({ reference, scriptRelative, scriptArgs, backupRoot = defaultBackupRoot() }) {
  if (!reference || !APPROVAL_REFERENCE_FORMAT.test(reference)) refuse("approval reference missing or malformed");
  if (!/STANDING/i.test(reference)) return "one-off";

  if (reference !== STANDING_BACKUP_REFERENCE) refuse("only WEEKLY-BACKUP-STANDING is a standing approval");
  if (scriptRelative.split("\\").join("/") !== STANDING_BACKUP_SCRIPT) {
    refuse("the standing approval covers scripts/backup/backup.mjs only");
  }
  if (scriptArgs.length !== 3 || scriptArgs[1] !== "--expect") refuse("standing backup arguments must be: <outDir> --expect <production project>");
  const [outDir, , expected] = scriptArgs;
  if (!expected || expected.length < 6 || !PRODUCTION_DB_PROJECT.startsWith(expected)) {
    refuse("the standing backup must expect the Production project");
  }
  const target = resolve(outDir);
  const root = resolve(backupRoot);
  const rel = relative(root, target);
  if (!isAbsolute(outDir) || rel.startsWith("..") || isAbsolute(rel) || dirname(target) !== root) {
    refuse("the standing backup must write directly under the backup root");
  }
  if (!STANDING_BACKUP_NAME.test(basename(target))) refuse("the standing backup folder must be named auto-YYYY-MM-DD or weekly-YYYY-MM-DD");
  return "standing-backup";
}
