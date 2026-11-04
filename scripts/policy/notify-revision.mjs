#!/usr/bin/env node
// 이용약관·개인정보처리방침 변경 안내 -- one in-app notification per member for
// the current revision (src/lib/policy/revisionNotice.ts; keep the values
// below in step with it). Idempotent: the Notification unique key
// (user, type, related_type, related_id) makes a re-run insert nothing new.
//
//   node --env-file=.env.preview.local scripts/policy/notify-revision.mjs --expect <project-ref> --user-ids 1,2
//   node --env-file=.env scripts/policy/notify-revision.mjs --expect <prod-ref> --all --confirm-production
//
// - Refuses unless DIRECT_URL belongs to --expect (like scripts/backup).
// - --user-ids: only those members (Preview tests). --all: every active,
//   not-withdrawn member, and only with --confirm-production.
// - Reading the notice is never recorded as consent.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"));
const { Client } = require("pg");

const NOTICE = {
  relatedType: "policy_revision",
  relatedId: 20261105,
  title: "이용약관 및 개인정보처리방침 변경 안내",
  content: "감사 후기 기능과 회원 탈퇴 시 후기 처리 기준이 추가되었습니다. 변경 내용을 확인해 주세요.",
};

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const expected = arg("--expect");
const userIds = arg("--user-ids")?.split(",").map(Number);
const all = args.includes("--all");
if (!expected || (!userIds && !all) || (userIds && all)) throw new Error("usage: --expect <project-ref> (--user-ids 1,2 | --all --confirm-production)");
if (userIds && !userIds.every((n) => Number.isInteger(n) && n > 0)) throw new Error("--user-ids must be positive integers");
if (all && !args.includes("--confirm-production")) throw new Error("--all needs --confirm-production");

const url = process.env.DIRECT_URL ?? "";
const ref = new URL(url).username.split(".")[1];
if (ref !== expected) throw new Error(`DIRECT_URL is project ${ref?.slice(0, 6)}…, not the expected one`);

const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  const r = await c.query(
    `INSERT INTO "Notification" (user_id, type, title, content, related_type, related_id)
     SELECT u.id, 'announcement', $1, $2, $3, $4
     FROM "User" u
     WHERE u.deleted_at IS NULL AND u.withdrawn_at IS NULL ${userIds ? "AND u.id = ANY($5::int[])" : ""}
     ON CONFLICT (user_id, type, related_type, related_id) DO NOTHING
     RETURNING user_id`,
    [NOTICE.title, NOTICE.content, NOTICE.relatedType, NOTICE.relatedId, ...(userIds ? [userIds] : [])],
  );
  console.log(`created ${r.rowCount} notification(s)${userIds ? ` for ${userIds.join(",")}` : " (all members)"}; existing ones were left as they are`);
} finally {
  await c.end();
}
