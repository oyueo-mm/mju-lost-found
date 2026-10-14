// Prints the value-free 이름·소속 diagnostics ("Identity sign-in check",
// "Identity collection after consent") from a deployment's runtime logs, for
// the real-account test. Nothing else from the logs is printed.
//
//   node scripts/identity-signin-log.mjs [deployment-url] [since, e.g. 2h]
import { execFileSync } from "node:child_process";

const deployment = process.argv[2] ?? "mju-lost-found-preview.vercel.app";
const since = process.argv[3] ?? "2h";
const out = execFileSync(
  process.platform === "win32" ? "vercel.cmd" : "vercel",
  ["logs", "--deployment", deployment, "--since", since, "--json", "-n", "1000"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell: process.platform === "win32" },
);
const rows = [];
for (const line of out.split("\n")) {
  if (!line.trim()) continue;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }
  for (const msg of String(entry.message ?? "").split("\n")) {
    const match = msg.match(/(Identity sign-in check|Identity collection after consent): (\{.*\})/);
    if (match) rows.push(`${new Date(entry.timestamp).toISOString()}  ${match[1]}  ${match[2]}`);
  }
}
console.log(rows.length ? rows.sort().join("\n") : `no 이름·소속 diagnostics on ${deployment} in the last ${since}`);
