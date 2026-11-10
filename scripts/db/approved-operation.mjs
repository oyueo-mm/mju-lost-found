// Safety interlock, not an authorization service: approval must come from the operator's change process.
import { readFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";

const args = process.argv.slice(2);
const divider = args.indexOf("--");
const approvalIndex = args.indexOf("--approval-reference");
if (!args.includes("--confirm-production") || approvalIndex < 0 || divider < 0) {
  throw new Error("Usage: approved-operation.mjs --confirm-production --approval-reference CHANGE-ID -- scripts/path.mjs [args]");
}
const script = args[divider + 1];
const scriptPath = script && resolve(script);
const scriptRelative = scriptPath && relative(resolve("scripts"), scriptPath);
if (!scriptRelative || isAbsolute(scriptRelative) || !scriptRelative.match(/^(?!\.\.)(?!.*(?:^|[/\\])db[/\\]).+\.mjs$/)) {
  throw new Error("Only an explicit repository operations .mjs script is permitted; Next servers and unit tests are not.");
}
const env = { ...process.env, ...parse(readFileSync(".env.operations-production")),
  MJU_DB_OPERATION: "approved", MJU_DB_APPROVAL_REFERENCE: args[approvalIndex + 1],
  NODE_ENV: "production", VERCEL: "", VERCEL_ENV: "", VERCEL_DEPLOYMENT_ID: "" };
assertDatabaseEnvironment(env, { usage: "operation" });
const guard = fileURLToPath(new URL("./install-guard.mjs", import.meta.url));
const result = spawnSync(process.execPath, ["--import", guard, scriptPath, ...args.slice(divider + 2)], { env, stdio: "inherit" });
process.exit(result.status ?? 1);
