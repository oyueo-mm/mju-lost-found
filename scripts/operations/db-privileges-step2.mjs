// Production DB residual privilege cleanup ("step 2", audit 2026-11-12/21).
// Scope: client roles only -- PUBLIC, anon, authenticated -- in schema public.
// service_role, owners (postgres / pg_database_owner), SECURITY DEFINER
// functions' explicit grants (mju_chat_realtime), other schemas (storage,
// realtime, auth, graphql) and supabase_admin-owned default ACLs are NOT touched.
//
//   snapshot                      read-only: print the ACL snapshot JSON (every non-owner entry)
//   plan                          read-only: print the revoke SQL and the target-state checks
//   verify                        read-only: check the target state
//   apply   --snapshot-out <f> --apply --confirm-<target>
//                                 write the pre-change snapshot to <f> FIRST, then revoke in one transaction, then verify
//   restore --from <f> [--all-roles] --apply --confirm-<target>
//                                 put back exactly the snapshot's entries (client roles; --all-roles also
//                                 service_role/postgres entries and the schema owner) in one transaction
//   reproduce --from <production snapshot> --preview-original-out <f> --apply --confirm-preview
//                                 Preview only: save Preview's own snapshot, then copy Production's
//                                 schema owner and all non-owner entries onto Preview
// Production: node scripts/db/approved-operation.mjs --confirm-production --approval-reference <REF> -- scripts/operations/db-privileges-step2.mjs <action> ...
import "../db/install-guard.mjs";
import { Client } from "pg";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";
import { pgConfig } from "../db/pgConfig.mjs";

const CLIENT = ["PUBLIC", "anon", "authenticated"];
const [action, ...flags] = process.argv.slice(2);
const target = assertDatabaseEnvironment(process.env, { usage: "operation" });
if (!["preview", "production"].includes(target)) throw new Error("Hosted target required");
const opt = (name) => { const i = flags.indexOf(`--${name}`); return i >= 0 ? flags[i + 1] : undefined; };
const apply = flags.includes("--apply");
if (apply && !flags.includes(`--confirm-${target}`)) throw new Error("Target confirmation required");
if (!["snapshot", "plan", "verify", "apply", "restore", "reproduce", "rehearsal-sql"].includes(action)) throw new Error("Unknown action");
if (["apply", "restore", "reproduce"].includes(action) && !apply) throw new Error(`${action} changes privileges: add --apply --confirm-${target}`);
if (action === "reproduce" && target !== "preview") throw new Error("reproduce is Preview only");

const ident = (s) => `"${String(s).replaceAll('"', '""')}"`;
const role = (g) => (g === "PUBLIC" ? "PUBLIC" : ident(g));
const db = new Client(pgConfig(process.env.DIRECT_URL, { connectionTimeoutMillis: 15000 }));

async function snapshot() {
  const q = async (sql) => (await db.query(sql)).rows;
  const g = (col) => `CASE ${col} WHEN 0 THEN 'PUBLIC' ELSE ${col}::regrole::text END`;
  return {
    target, at: new Date().toISOString(),
    schema: (await q(`SELECT nspowner::regrole::text AS owner, coalesce((SELECT json_agg(json_build_object('grantee',${g("a.grantee")},'privilege',a.privilege_type) ORDER BY 1) FROM aclexplode(n.nspacl) a WHERE a.grantee<>n.nspowner),'[]') AS entries FROM pg_namespace n WHERE nspname='public'`))[0],
    relations: await q(`SELECT c.relname AS name, c.relkind AS kind, coalesce((SELECT json_agg(json_build_object('grantee',${g("a.grantee")},'privilege',a.privilege_type) ORDER BY 1) FROM aclexplode(c.relacl) a WHERE a.grantee<>c.relowner),'[]') AS entries
      FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','v','m','S','f') ORDER BY 1`),
    functions: await q(`SELECT format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) AS signature, p.proacl IS NULL AS default_acl,
      coalesce((SELECT json_agg(json_build_object('grantee',${g("a.grantee")},'privilege',a.privilege_type) ORDER BY 1) FROM aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner),'[]') AS entries
      FROM pg_proc p WHERE p.pronamespace='public'::regnamespace ORDER BY 1`),
    defaults: await q(`SELECT defaclobjtype AS type, coalesce((SELECT json_agg(json_build_object('grantee',${g("a.grantee")},'privilege',a.privilege_type) ORDER BY 1) FROM aclexplode(d.defaclacl) a WHERE a.grantee<>d.defaclrole),'[]') AS entries
      FROM pg_default_acl d WHERE d.defaclrole='postgres'::regrole AND d.defaclnamespace='public'::regnamespace ORDER BY 1`),
  };
}

const REVOKE_SQL = [
  `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated`,
  `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated`,
  `REVOKE ALL ON SCHEMA public FROM PUBLIC, anon, authenticated`,
  `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated`,
  `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated`,
  `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated`,
];

const objType = { r: "TABLE", p: "TABLE", v: "TABLE", m: "TABLE", f: "TABLE", S: "SEQUENCE" };
const defType = { r: "TABLES", S: "SEQUENCES", f: "FUNCTIONS", T: "TYPES", n: "SCHEMAS" };
// Statements that make the live entries for `roles` equal to the snapshot's.
function restoreSql(snap, roles, withOwner) {
  const keep = (e) => roles.includes(e.grantee);
  const list = (rs) => rs.map(role).join(", ");
  const grants = (entries, on) => {
    const by = new Map();
    for (const e of entries.filter(keep)) by.set(e.grantee, [...(by.get(e.grantee) ?? []), e.privilege]);
    return [...by].map(([g, p]) => `GRANT ${[...new Set(p)].join(", ")} ON ${on} TO ${role(g)}`);
  };
  const sql = [];
  // Never revoke from an owner: the schema's owner (after any owner change)
  // and postgres, which owns every public relation and function.
  const schemaRoles = roles.filter((r) => r !== snap.schema.owner);
  const objectRoles = roles.filter((r) => r !== "postgres");
  if (withOwner) sql.push(`ALTER SCHEMA public OWNER TO ${role(snap.schema.owner)}`);
  sql.push(`REVOKE ALL ON SCHEMA public FROM ${list(schemaRoles)}`, ...grants(snap.schema.entries, "SCHEMA public"));
  for (const r of snap.relations) {
    const on = `${objType[r.kind]} public.${ident(r.name)}`;
    sql.push(`REVOKE ALL ON ${on} FROM ${list(objectRoles)}`, ...grants(r.entries, on));
  }
  for (const f of snap.functions) sql.push(`REVOKE EXECUTE ON FUNCTION ${f.signature} FROM ${list(objectRoles)}`, ...grants(f.entries, `FUNCTION ${f.signature}`));
  const defaultRoles = objectRoles.filter((r) => r !== "PUBLIC");
  for (const t of ["r", "S"]) sql.push(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON ${defType[t]} FROM ${list(defaultRoles)}`);
  for (const d of snap.defaults) {
    const by = new Map();
    for (const e of d.entries.filter((e) => defaultRoles.includes(e.grantee))) by.set(e.grantee, [...(by.get(e.grantee) ?? []), e.privilege]);
    for (const [g, p] of by) sql.push(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ${[...new Set(p)].join(", ")} ON ${defType[d.type]} TO ${role(g)}`);
  }
  return sql;
}

async function verify() {
  const q = async (sql) => (await db.query(sql)).rows;
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) });
  const rel = await q(`SELECT r AS role, count(*)::int AS n FROM pg_class c, unnest(ARRAY['anon','authenticated']) r, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
    WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','v','m','f') AND has_table_privilege(r,c.oid,p) GROUP BY 1`);
  check("anon/authenticated: no privilege on any public table or view", rel.length === 0, rel);
  const seq = await q(`SELECT count(*)::int AS n FROM pg_class c, unnest(ARRAY['anon','authenticated']) r, unnest(ARRAY['SELECT','UPDATE','USAGE']) p WHERE c.relnamespace='public'::regnamespace AND c.relkind='S' AND has_sequence_privilege(r,c.oid,p)`);
  check("anon/authenticated: no sequence privilege", seq[0].n === 0, seq[0].n);
  const sch = await q(`SELECT r AS role, has_schema_privilege(r,'public','USAGE') AS usage, has_schema_privilege(r,'public','CREATE') AS "create" FROM unnest(ARRAY['anon','authenticated']) r`);
  check("anon/authenticated: no USAGE/CREATE on schema public", sch.every((s) => !s.usage && !s.create), sch);
  const pub = await q(`SELECT count(*)::int AS n FROM pg_namespace n, aclexplode(n.nspacl) a WHERE n.nspname='public' AND a.grantee=0`);
  check("PUBLIC: no entry on schema public", pub[0].n === 0, pub[0].n);
  const fn = await q(`SELECT p.proname FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE') OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0))`);
  check("no public function executable by PUBLIC/anon/authenticated", fn.length === 0, fn.map((r) => r.proname));
  const def = await q(`SELECT d.defaclobjtype AS type, a.grantee::regrole::text AS grantee FROM pg_default_acl d, aclexplode(d.defaclacl) a WHERE d.defaclrole='postgres'::regrole AND d.defaclnamespace='public'::regnamespace AND a.grantee IN ('anon'::regrole,'authenticated'::regrole)`);
  check("postgres default ACL in public: nothing for anon/authenticated", def.length === 0, def);
  // Must stay: owner, service_role, the D-3 receive grant, triggers.
  const keep = (await q(`SELECT has_schema_privilege('postgres','public','USAGE') AND has_schema_privilege('postgres','public','CREATE') AS postgres_schema,
      has_schema_privilege('service_role','public','USAGE') AS service_role_usage,
      has_function_privilege('mju_chat_realtime','public.mju_chat_realtime_receive()','EXECUTE') AS realtime_receive,
      NOT has_function_privilege('mju_chat_realtime','public.mju_chat_member_allowed(integer,integer)','EXECUTE') AS member_allowed_private,
      (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal AND t.tgenabled<>'D') AS enabled_triggers,
      (SELECT count(*)::int FROM pg_proc WHERE pronamespace='public'::regnamespace AND prosecdef) AS definer_functions`))[0];
  check("kept: postgres USAGE+CREATE, D-3 receive grant, member check private", keep.postgres_schema && keep.realtime_receive && keep.member_allowed_private, keep);
  return checks;
}

// rehearsal-sql --from <production snapshot> --out <dir>: write <dir>/migration.sql
// for protect.ps1 -Rehearse (throwaway restored copy only; it is restored
// with --no-privileges, so roles and Production's ACLs are recreated first).
if (action === "rehearsal-sql") {
  const prod = JSON.parse(readFileSync(opt("from") ?? "", "utf8"));
  const dir = opt("out");
  if (prod.target !== "production" || !dir) throw new Error("--from <production snapshot> --out <dir> required");
  const grantees = [...new Set([...CLIENT, "service_role", "postgres", ...prod.schema.entries.map((e) => e.grantee)])];
  const sql = [
    "-- THROWAWAY RESTORED COPY ONLY (protect.ps1 -Rehearse). Generated by db-privileges-step2.mjs rehearsal-sql.",
    "BEGIN;",
    "DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','pg_database_owner'] LOOP IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF; END LOOP; END $$;",
    "-- 1) recreate Production's current ACL state",
    ...restoreSql(prod, grantees, true).map((s) => s + ";"),
    "DO $$ BEGIN IF NOT has_table_privilege('anon','public.\"User\"','TRUNCATE') OR NOT has_schema_privilege('anon','public','USAGE') THEN RAISE EXCEPTION 'reproduction failed'; END IF; END $$;",
    "-- 2) the exact step-2 revoke",
    ...REVOKE_SQL.map((s) => s + ";"),
    "-- 3) target state",
    `DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c, unnest(ARRAY['anon','authenticated']) r, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','v') AND has_table_privilege(r,c.oid,p)) THEN RAISE EXCEPTION 'table privileges remain'; END IF;
  IF has_schema_privilege('anon','public','USAGE') OR has_schema_privilege('authenticated','public','USAGE') THEN RAISE EXCEPTION 'schema usage remains'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND has_function_privilege('anon',p.oid,'EXECUTE')) THEN RAISE EXCEPTION 'function execute remains'; END IF;
  IF NOT has_table_privilege('service_role','public."User"','TRUNCATE') OR NOT has_schema_privilege('service_role','public','USAGE') THEN RAISE EXCEPTION 'service_role changed'; END IF;
  IF to_regrole('mju_chat_realtime') IS NOT NULL AND NOT has_function_privilege('mju_chat_realtime','public.mju_chat_realtime_receive()','EXECUTE') THEN RAISE EXCEPTION 'realtime receive grant lost'; END IF;
END $$;`,
    "-- 4) rollback to Production's current state must also apply cleanly",
    ...restoreSql(prod, CLIENT, false).map((s) => s + ";"),
    "DO $$ BEGIN IF NOT has_table_privilege('anon','public.\"User\"','TRUNCATE') OR NOT has_schema_privilege('anon','public','USAGE') THEN RAISE EXCEPTION 'rollback did not restore'; END IF; END $$;",
    "COMMIT;",
  ];
  const { mkdirSync } = await import("node:fs");
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/migration.sql`, sql.join("\n") + "\n");
  console.log(JSON.stringify({ written: `${dir}/migration.sql`, statements: sql.length }));
  process.exit(0);
}

try {
  await db.connect();
  if (action === "snapshot") { await db.query("BEGIN READ ONLY"); console.log(JSON.stringify(await snapshot(), null, 1)); await db.query("ROLLBACK"); }
  else if (action === "plan") { console.log(REVOKE_SQL.map((s) => s + ";").join("\n")); }
  else if (action === "verify") { await db.query("BEGIN READ ONLY"); const c = await verify(); await db.query("ROLLBACK"); console.log(JSON.stringify({ target, passed: c.every((x) => x.ok), checks: c }, null, 1)); if (!c.every((x) => x.ok)) process.exitCode = 1; }
  else {
    let statements;
    if (action === "apply") {
      const out = opt("snapshot-out");
      if (!out || existsSync(out)) throw new Error("--snapshot-out <new file> required (never overwritten)");
      await db.query("BEGIN READ ONLY"); writeFileSync(out, JSON.stringify(await snapshot(), null, 1)); await db.query("ROLLBACK");
      statements = REVOKE_SQL;
    } else if (action === "restore") {
      const snap = JSON.parse(readFileSync(opt("from") ?? "", "utf8"));
      if (snap.target !== target) throw new Error(`Snapshot is for ${snap.target}, not ${target}`);
      const all = flags.includes("--all-roles");
      const roles = all ? [...new Set([...CLIENT, "service_role", "postgres", ...snap.schema.entries.map((e) => e.grantee)])] : CLIENT;
      statements = restoreSql(snap, roles, all);
    } else {
      const prod = JSON.parse(readFileSync(opt("from") ?? "", "utf8"));
      if (prod.target !== "production") throw new Error("reproduce needs a Production snapshot");
      const out = opt("preview-original-out");
      if (!out || existsSync(out)) throw new Error("--preview-original-out <new file> required");
      await db.query("BEGIN READ ONLY"); const own = await snapshot(); await db.query("ROLLBACK");
      writeFileSync(out, JSON.stringify(own, null, 1));
      const names = new Set(own.relations.map((r) => r.name)), sigs = new Set(own.functions.map((f) => f.signature));
      const missing = prod.relations.filter((r) => !names.has(r.name)).map((r) => r.name).concat(prod.functions.filter((f) => !sigs.has(f.signature)).map((f) => f.signature));
      if (missing.length) throw new Error(`Preview lacks objects present on Production: ${missing.join(", ")}`);
      const grantees = [...new Set([...CLIENT, "service_role", "postgres", ...prod.schema.entries.map((e) => e.grantee)])];
      statements = restoreSql({ ...prod, relations: prod.relations, functions: prod.functions }, grantees, true);
    }
    await db.query("BEGIN");
    await db.query("SET LOCAL lock_timeout = '5s'");
    await db.query("SET LOCAL statement_timeout = '60s'");
    for (const s of statements) await db.query(s);
    await db.query("COMMIT");
    console.log(JSON.stringify({ target, action, statements: statements.length }));
    if (action === "apply") { await db.query("BEGIN READ ONLY"); const c = await verify(); await db.query("ROLLBACK"); console.log(JSON.stringify({ target, passed: c.every((x) => x.ok), checks: c }, null, 1)); if (!c.every((x) => x.ok)) process.exitCode = 1; }
  }
} catch (error) {
  await db.query("ROLLBACK").catch(() => {});
  console.error("Privilege step 2 stopped:", error.message);
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
