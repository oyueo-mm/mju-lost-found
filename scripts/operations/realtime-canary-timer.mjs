// Production canary follow-up: timer-based return + message consistency.
// Run ONLY through approved-operation.mjs, starting from polling with both
// members' room tabs open and VISIBLE (the polling notice on screen):
//
//   node scripts/db/approved-operation.mjs --confirm-production --approval-reference <REF> -- \
//     scripts/operations/realtime-canary-timer.mjs --confirm-production 52 <kid>
//
//   1 private on; both tabs must obtain new grants by themselves (the 120 s
//     re-check). Visibility diagnostics are read afterwards to prove no
//     hidden->visible event triggered it.
//   2 private messages: wait (up to 4 min) until the room has 2 more messages
//     (members send A->B and B->A when the notice disappears).
//   3 polling forced; wait (up to 5 min) for 1 more message (sent from the
//     phone when the notice reappears).
// Always ends in polling and prints the active grant count. Reads message
// COUNTS only (never content).
import "../db/install-guard.mjs";
import { spawnSync } from "node:child_process";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";

const [confirmation, room, kid, ...extra] = process.argv.slice(2);
const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
if (extra.length || confirmation !== `--confirm-${target}` || !["production", "preview"].includes(target) || !/^[1-9]\d{0,9}$/.test(room ?? "") || !/^[0-9a-f-]{36}$/i.test(kid ?? "")) {
  throw new Error("usage: realtime-canary-timer.mjs --confirm-<target> <room> <kid>");
}
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
async function until(check, seconds, label) {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    const v = check();
    if (v.done) return v;
    if (Date.now() > end) throw new Error(`${label}: ${v.note}`);
    await sleep(5000);
  }
}

let ok = false;
try {
  const base = inspect(new Date().toISOString()).existingMessages;
  log("0 start (polling)", { messages: base });

  const t1 = new Date();
  mode("private");
  log("1 private on");
  const g = await until(() => { const s = inspect(t1.toISOString()); return { done: s.activeProbeGrants >= 2, note: `${s.activeProbeGrants} of 2 grants`, s }; }, 240, "1 timer return");
  log("1 both tabs returned by themselves", { seconds: Math.round((Date.now() - t1.getTime()) / 1000), grants: g.s.activeProbeGrants });

  const m2 = await until(() => { const s = inspect(t1.toISOString()); return { done: s.existingMessages >= base + 2, note: `${s.existingMessages - base} of 2 private-mode messages`, s }; }, 240, "2 private messages");
  log("2 private-mode messages stored", { added: m2.s.existingMessages - base });
  const afterPrivate = m2.s.existingMessages;

  mode("polling");
  log("3 polling forced");
  const m3 = await until(() => { const s = inspect(new Date(Date.now() - 60000).toISOString()); return { done: s.existingMessages >= afterPrivate + 1, note: `${s.existingMessages - afterPrivate} of 1 polling-mode message`, s }; }, 300, "3 polling message");
  log("3 polling-mode message stored", { added: m3.s.existingMessages - afterPrivate, total: m3.s.existingMessages });
  ok = true;
} catch (error) {
  log("FAILED", { reason: error.message });
} finally {
  try { const f = mode("polling"); log("END polling", { mode: f.state?.config?.mode, activeGrants: f.state?.counts?.active }); }
  catch { log("END polling restore FAILED - run release-d3.mjs polling now"); process.exitCode = 2; }
}
if (!ok && !process.exitCode) process.exitCode = 1;
