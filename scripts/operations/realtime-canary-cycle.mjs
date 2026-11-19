// One-shot Production canary check of private -> polling -> private with the
// members' own open tabs. Run ONLY through approved-operation.mjs:
//
//   node scripts/db/approved-operation.mjs --confirm-production --approval-reference <REF> -- \
//     scripts/operations/realtime-canary-cycle.mjs --confirm-production 52 <kid>
//
// Steps (decided from DB grants, the source of truth; no message content read):
//   A  private on; wait up to 6 min for both members' fresh grants
//   B  non-persistent challenge to each grant (receipts checked in logs later)
//   C  polling (grants revoked at once); wait 150 s
//   D  private again; wait up to 4 min for both tabs to obtain NEW grants
//      without any action (tabs re-check every 120 s)
//   E  challenge again
// Always ends in polling. Any failed step restores polling and exits 1.
// Prints timings, grant counts and challenge nonces (for realtime-receipt-logs.mjs).
import "../db/install-guard.mjs";
import { spawnSync } from "node:child_process";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";

const [confirmation, roomArg, kid, ...extra] = process.argv.slice(2);
const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
if (extra.length || confirmation !== `--confirm-${target}` || !["production", "preview"].includes(target) || !/^[1-9]\d{0,9}$/.test(roomArg ?? "") || !/^[0-9a-f-]{36}$/i.test(kid ?? "")) {
  throw new Error("usage: realtime-canary-cycle.mjs --confirm-<target> <room> <kid>");
}
const room = roomArg;
const log = (step, data = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), step, ...data }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(script, args) {
  const r = spawnSync(process.execPath, [script, ...args], { env: process.env, encoding: "utf8", windowsHide: true, timeout: 60000 });
  const line = (r.stdout ?? "").trim().split(/\r?\n/).filter((l) => l.startsWith("{")).pop();
  if (r.status !== 0 || !line) throw new Error(`${script} ${args[0]} failed`);
  return JSON.parse(line);
}
const mode = (m) => run("scripts/operations/release-d3.mjs", m === "private" ? ["private", "--kid", kid, "--apply", `--confirm-${target}`] : ["polling", "--apply", `--confirm-${target}`]);
const inspect = (since) => run("scripts/operations/realtime-member-check.mjs", ["inspect", `--confirm-${target}`, room, since, "--min-messages=0"]);
const challenge = (since) => run("scripts/operations/realtime-member-check.mjs", ["send", `--confirm-${target}`, room, since, "--min-messages=0"]);

async function waitGrants(since, seconds, label) {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    const s = inspect(since);
    if (s.activeProbeGrants >= 2) return s;
    if (Date.now() > end) throw new Error(`${label}: ${s.activeProbeGrants} of 2 grants`);
    await sleep(10000);
  }
}

let ok = false;
try {
  const startA = new Date(Date.now() - 5 * 60000).toISOString();
  mode("private");
  log("A private on");
  const a = await waitGrants(startA, 360, "A");
  log("A both members connected", { grants: a.activeProbeGrants });
  const b = challenge(startA);
  log("B challenge sent", { nonces: b.expectedReceipts });

  const tC = Date.now();
  const c = mode("polling");
  log("C polling forced", { activeGrantsAfter: c.state?.counts?.active });
  await sleep(150000);
  const cAfter = inspect(new Date(tC).toISOString());
  log("C after 150 s", { grantsIssuedSincePolling: cAfter.activeProbeGrants });
  if (cAfter.activeProbeGrants !== 0) throw new Error("C: a grant was issued while polling");

  const tD = new Date();
  mode("private");
  log("D private again");
  const d = await waitGrants(tD.toISOString(), 240, "D");
  log("D both tabs returned without action", { seconds: Math.round((Date.now() - tD.getTime()) / 1000), grants: d.activeProbeGrants });
  const e = challenge(tD.toISOString());
  log("E challenge sent", { nonces: e.expectedReceipts });
  ok = true;
} catch (error) {
  log("FAILED", { reason: error.message });
} finally {
  try { const f = mode("polling"); log("END polling restored", { mode: f.state?.config?.mode, activeGrants: f.state?.counts?.active }); }
  catch { log("END polling restore FAILED - run release-d3.mjs polling now"); process.exitCode = 2; }
}
if (!ok && !process.exitCode) process.exitCode = 1;
