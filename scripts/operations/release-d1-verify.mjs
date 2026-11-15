// Preview-only integration test: four independent processes use the real
// services and shared Postgres counters. No schema changes or real users.
import "../db/install-guard.mjs";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";
import { createJiti } from "jiti";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

if (assertDatabaseEnvironment(process.env, { usage: "operation" }) !== "preview") {
  throw new Error("Preview only");
}
const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } });
const { prisma } = await jiti.import("../../src/lib/db/prisma.ts");
const { checkRateLimit } = await jiti.import("../../src/lib/rateLimit/index.ts");
// Prevent maintenance from pruning unrelated Preview counters during this test.
Math.random = () => 1;
const [mode, action, rawId, rawCount, tier, rawClock] = process.argv.slice(2);
if (mode === "worker") {
  Date.now = () => Number(rawClock);
  const results = [];
  try {
    if (action === "keyword") {
      const { createKeywordAlert } = await jiti.import("../../src/lib/keywordAlert/service.ts");
      const user = await prisma.user.findUniqueOrThrow({ where: { id: Number(rawId) } });
      if (!user.email.endsWith("@release-d1.example.invalid")) throw new Error("Not a test user");
      for (let i = 0; i < Number(rawCount); i++) {
        const r = await createKeywordAlert(user, { keyword: "D1 isolated test", postType: "all", campuses: [], categories: [], excludeKeywords: [] });
        results.push(r.kind);
      }
    } else {
      for (let i = 0; i < Number(rawCount); i++) {
        const r = await checkRateLimit(action, { userId: Number(rawId), tier });
        results.push(r.ok ? "ok" : r.reason);
      }
    }
    console.log(JSON.stringify(results));
  } finally { await prisma.$disconnect(); }
} else {
  const marker = randomUUID();
  const email = `${marker}@release-d1.example.invalid`;
  const clock = Date.now();
  let user;
  function worker(action, id, n, tier = "user") {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "worker", action, String(id), String(n), tier, String(clock)], { env: process.env, windowsHide: true });
      let out = "";
      child.stdout.on("data", b => { out += b; });
      child.stderr.on("data", () => {}); // Never emit driver errors/connection details.
      child.on("error", () => reject(new Error("Worker spawn failed")));
      child.on("close", code => {
        if (code !== 0) return reject(new Error(`Worker failed (${code})`));
        try { resolve(JSON.parse(out.trim().split("\n").at(-1))); }
        catch { reject(new Error("Worker result invalid")); }
      });
    });
  }
  function check(label, results, expected) {
    const counts = {};
    for (const r of results.flat()) counts[r] = (counts[r] ?? 0) + 1;
    if (JSON.stringify(Object.entries(counts).sort()) !== JSON.stringify(Object.entries(expected).sort())) throw new Error(`${label} unexpected counts: ${JSON.stringify(counts)}`);
    console.log(JSON.stringify({ check: label, counts, passed: true }));
  }
  try {
    // Allocate a disposable user to obtain a unique, collision-free subject ID.
    user = await prisma.user.create({ data: { email, name: "D1 isolated verification", nickname: "D1 verification" } });
    check("four-process quota", await Promise.all(Array.from({ length: 4 }, () => worker("commentCreate", user.id, 8))), { ok: 10, limited: 22 });
    const counters = await prisma.rateLimitCounter.findMany({ where: { key: { startsWith: `commentCreate:u:${user.id}:` } } });
    if (counters.length !== 2 || counters.some(r => r.count !== 10)) throw new Error("Rollback charged a rejected request");
    console.log(JSON.stringify({ check: "all-window rollback", counters: counters.map(r => r.count), passed: true }));
    check("normal upload burst", [await worker("imageUpload", user.id, 31)], { ok: 30, limited: 1 });
    await prisma.rateLimitCounter.deleteMany({ where: { key: { startsWith: `imageUpload:u:${user.id}:` } } });
    check("staff consecutive uploads", [await worker("imageUpload", user.id, 31, "staff")], { ok: 31 });
    check("staff consecutive posts", [await worker("postCreate", user.id, 16, "staff")], { ok: 16 });
    check("four-process keyword cap", await Promise.all(Array.from({ length: 4 }, () => worker("keyword", user.id, 7))), { ok: 20, too_many: 8 });
    if (await prisma.keywordAlert.count({ where: { userId: user.id } }) !== 20) throw new Error("Keyword cap failed");
  } finally {
    if (user) {
      const owned = await prisma.user.findUnique({ where: { id: user.id } });
      if (owned?.email !== email) throw new Error("Cleanup ownership mismatch");
      const removed = await prisma.keywordAlert.deleteMany({ where: { userId: user.id } });
      const counters = await prisma.rateLimitCounter.deleteMany({ where: { OR: ["commentCreate", "imageUpload", "postCreate", "keywordCreate"].map(a => ({ key: { startsWith: `${a}:u:${user.id}:` } })) } });
      await prisma.user.delete({ where: { id: user.id } });
      console.log(JSON.stringify({ cleanup: true, userId: user.id, keywords: removed.count, counters: counters.count }));
    }
    await prisma.$disconnect();
  }
}
