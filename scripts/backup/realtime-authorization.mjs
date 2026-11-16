// Scoped D3 authorization metadata. No signing material, user IDs or tokens.
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

export async function captureRealtimeAuthorization(db) {
  if (!(await db.query(`SELECT to_regclass('public."ChatRealtimeConfig"') IS NOT NULL AS present`)).rows[0].present) return null;
  const role=(await db.query(`SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls FROM pg_roles WHERE rolname='mju_chat_realtime'`)).rows[0];
  if (!role) throw new Error("D3 authorization role missing");
  const policies=(await db.query(`SELECT policyname,permissive,roles::text[] AS roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='realtime' AND tablename='messages' AND policyname='mju_chat_private_receive' ORDER BY policyname`)).rows;
  const permissions=(await db.query(`SELECT has_schema_privilege('mju_chat_realtime','realtime','USAGE') AS schema_usage,has_table_privilege('mju_chat_realtime','realtime.messages','SELECT') AS receive,has_table_privilege('mju_chat_realtime','realtime.messages','INSERT') AS send,has_table_privilege('mju_chat_realtime','realtime.messages','UPDATE') AS change,has_table_privilege('mju_chat_realtime','realtime.messages','DELETE') AS remove`)).rows[0];
  const functions=(await db.query(`SELECT p.proname,has_function_privilege('mju_chat_realtime',p.oid,'EXECUTE') AS executable FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('mju_chat_member_allowed','mju_chat_realtime_receive','mju_revoke_rt_user','mju_rt_user_changed','mju_rt_member_changed','mju_rt_external_changed','mju_rt_test_mode_changed') ORDER BY p.proname`)).rows;
  return {version:1,role,policies,permissions,functions};
}

export function assertRealtimeAuthorization(value) {
  if (!value || value.version!==1 || value.role?.rolname!=="mju_chat_realtime" || ["rolcanlogin","rolinherit","rolsuper","rolcreaterole","rolcreatedb","rolbypassrls"].some(k=>value.role[k]!==false)) throw new Error("Unsafe D3 role metadata");
  if (value.policies?.length!==1 || value.policies[0].cmd!=="SELECT" || value.policies[0].roles?.join()!=="mju_chat_realtime" || value.policies[0].with_check!==null) throw new Error("Unexpected D3 policy metadata");
  const p=value.permissions;
  if (!p?.schema_usage || !p.receive || p.send!==false || p.change!==false || p.remove!==false) throw new Error("Unsafe D3 message privileges");
  if (value.functions?.length!==7 || value.functions.some(f=>f.executable!==(f.proname==="mju_chat_realtime_receive"))) throw new Error("Unsafe D3 function privileges");
}

export function realtimeRebuildSql(root=process.cwd()) {
  return readFileSync(resolve(root,"scripts/backup/realtime-rebuild.sql"),"utf8");
}

export function migrationRealtimeRebuildSql(root=process.cwd()) {
  const sources=[
    ["20261123000000_chat_realtime_grants","PUBLIC ACL"],
    ["20261123050000_chat_realtime_row_topic","POLICY"],
    ["20261123020000_chat_realtime_revocation","REVOCATION ACL"],
  ];
  return sources.map(([name,block])=>{
    const sql=readFileSync(resolve(root,"prisma/migrations",name,"migration.sql"),"utf8");
    const start=`-- BEGIN MJU REALTIME REBUILD ${block}`,end=`-- END MJU REALTIME REBUILD ${block}`;
    if (sql.split(start).length!==2 || sql.split(end).length!==2) throw new Error("Rebuild SQL marker missing or duplicated");
    return sql.split(start)[1].split(end)[0];
  }).join("\n");
}

// A local SQL/RLS model, not a replacement for hosted Realtime validation.
// The restore runner has already refused all non-local database targets.
export async function prepareLocalRealtimeModel(db) {
  if(!["127.0.0.1","localhost","::1"].includes(db.connectionParameters?.host))throw new Error("Realtime SQL model requires a local database");
  await db.query(`CREATE SCHEMA IF NOT EXISTS realtime;
    CREATE TABLE IF NOT EXISTS realtime.messages(topic text,extension text);
    ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
    CREATE OR REPLACE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('realtime.topic',true) $$;`);
}

export async function rebuildLocalRealtimeAuthorization(db,expected,sql=realtimeRebuildSql()) {
  assertRealtimeAuthorization(expected);
  await prepareLocalRealtimeModel(db);
  await db.query("BEGIN");
  try {
    await db.query(sql);
    const actual=await captureRealtimeAuthorization(db);
    assertRealtimeAuthorization(actual);
    if (JSON.stringify(actual)!==JSON.stringify(expected)) throw new Error("Restored D3 authorization metadata differs");
    await db.query("COMMIT");
  } catch(error) { await db.query("ROLLBACK");throw error; }
}
