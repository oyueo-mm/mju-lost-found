import {readFileSync} from "node:fs";
import {describe,it,expect} from "vitest";
import {assertRealtimeAuthorization,realtimeRebuildSql,migrationRealtimeRebuildSql} from "./realtime-authorization.mjs";
const valid=()=>({version:1,role:{rolname:"mju_chat_realtime",rolcanlogin:false,rolinherit:false,rolsuper:false,rolcreaterole:false,rolcreatedb:false,rolbypassrls:false},policies:[{cmd:"SELECT",roles:["mju_chat_realtime"],with_check:null}],permissions:{schema_usage:true,receive:true,send:false,change:false,remove:false},functions:["mju_chat_member_allowed","mju_chat_realtime_receive","mju_revoke_rt_user","mju_rt_user_changed","mju_rt_member_changed","mju_rt_external_changed","mju_rt_test_mode_changed"].map(proname=>({proname,executable:proname==="mju_chat_realtime_receive"}))});
describe("D3 authorization backup",()=>{
  it("rejects widened role, write grants and function access",()=>{
    expect(()=>assertRealtimeAuthorization(valid())).not.toThrow();
    for(const field of ["rolcanlogin","rolinherit","rolsuper","rolcreaterole","rolcreatedb","rolbypassrls"]){const v=valid();v.role[field as keyof typeof v.role]=true as never;expect(()=>assertRealtimeAuthorization(v)).toThrow();}
    const writes=valid();writes.permissions.send=true;expect(()=>assertRealtimeAuthorization(writes)).toThrow();
    const fn=valid();fn.functions[0].executable=true;expect(()=>assertRealtimeAuthorization(fn)).toThrow();
    const policy=valid();policy.policies[0].roles=["authenticated"];expect(()=>assertRealtimeAuthorization(policy)).toThrow();
  });
  it("rebuilds only D3 role, own policy and own function ACL",()=>{
    const sql=realtimeRebuildSql();
    expect(sql.replace(/^--[^\n]*\n/,"").replaceAll("\r\n","\n")).toBe(migrationRealtimeRebuildSql().replaceAll("\r\n","\n"));
    expect(sql).toContain("CREATE ROLE mju_chat_realtime NOLOGIN NOINHERIT NOBYPASSRLS");
    expect(sql).toContain("CREATE POLICY mju_chat_private_receive");
    expect(sql).not.toMatch(/GRANT\s+[^;]+\s+TO\s+(?:authenticator|supabase_realtime_admin|authenticated|anon)\b/i);
    expect(sql).not.toMatch(/DROP\s+(TABLE|SCHEMA|ROLE)|INSERT INTO|DELETE FROM|ALTER ROLE/i);
  });
  it("captures metadata using SELECT only inside the shared snapshot",()=>{
    const source=readFileSync("scripts/backup/realtime-authorization.mjs","utf8").split("export function assertRealtimeAuthorization")[0];
    const queries=[...source.matchAll(/db\.query\(`([\s\S]*?)`\)/g)];
    expect(queries.length).toBe(5);for(const query of queries)expect(query[1]).toMatch(/^SELECT\b/);
    const backup=readFileSync("scripts/backup/backup.mjs","utf8");
    expect(backup.indexOf("realtimeAuthorization=await capture")).toBeLessThan(backup.indexOf('await run("pg_dump"'));
  });
});
