// Function Storage C-2: local rehearsal of 20261124000000_text_embedding_jobs on
// a throw-away PostgreSQL (see text-job-migration-local.sh). No hosted
// credentials. Simulates Supabase client roles AND the residual default ACLs
// Production still has (DB privileges audit 2026-11-12), then checks:
// apply, privileges/RLS, trigger behaviour, rollback, re-apply.
import "../db/install-guard.mjs";
import { Client } from "pg";
import { readFileSync } from "node:fs";
const port = process.env.MJU_TEXT_JOB_TEST_PORT;
if (!/^\d+$/.test(port ?? "")) throw new Error("Isolated local test port required");
const db = new Client({ connectionString: `postgresql://postgres@127.0.0.1:${port}/postgres` });
const migration = readFileSync("prisma/migrations/20261124000000_text_embedding_jobs/migration.sql", "utf8");
const rollback = readFileSync("scripts/fixtures/text-job-rollback/rollback.sql", "utf8");
const results = [];
const must = (ok, name) => { results.push(name); if (!ok) throw new Error(`FAIL ${name}`); console.log("PASS", name); };
const one = async (sql, args) => (await db.query(sql, args)).rows[0];
const job = (type, id) => one(`SELECT generation,state,attempts FROM "TextEmbeddingJob" WHERE post_type=$1 AND post_id=$2`, [type, id]);

async function privilegeLeaks() {
  const table = (await db.query(`SELECT r.rolname, p FROM unnest(ARRAY['anon','authenticated','public']) r(rolname),
      unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
    WHERE has_table_privilege(CASE WHEN r.rolname='public' THEN 'nobody_probe' ELSE r.rolname END,'public."TextEmbeddingJob"',p)`)).rows;
  const acl = (await db.query(`SELECT a.grantee::regrole::text AS grantee,a.privilege_type FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid='public."TextEmbeddingJob"'::regclass AND a.grantee<>c.relowner`)).rows;
  const fn = (await db.query(`SELECT r FROM unnest(ARRAY['anon','authenticated','nobody_probe']) r WHERE has_function_privilege(r,'public.queue_text_embedding()','EXECUTE')`)).rows;
  return { table, acl, fn };
}

try {
  await db.connect();
  must((await one(`SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'`)).n === 0, "fresh local database");
  // Supabase-like client roles + a role with no grants (PUBLIC probe) + the residual default ACLs.
  await db.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE nobody_probe NOLOGIN;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, nobody_probe;
    CREATE TABLE "LostPost"(id serial PRIMARY KEY,user_id int NOT NULL,title text NOT NULL,description text NOT NULL,category text NOT NULL,location text,status text NOT NULL DEFAULT 'open',view_count int NOT NULL DEFAULT 0);
    CREATE TABLE "FoundPost"(id serial PRIMARY KEY,user_id int NOT NULL,title text NOT NULL,description text NOT NULL,category text NOT NULL,location text,status text NOT NULL DEFAULT 'open',view_count int NOT NULL DEFAULT 0);`);
  // Prove the simulation really leaks without the migration's REVOKEs.
  await db.query(`CREATE TABLE "LeakProbe"(id int)`);
  must((await one(`SELECT has_table_privilege('anon','"LeakProbe"','TRUNCATE') AS leak`)).leak === true, "simulated default ACL leaks to a plain new table");
  await db.query(`DROP TABLE "LeakProbe"`);

  for (const round of ["apply", "re-apply"]) {
    await db.query(migration);
    const leaks = await privilegeLeaks();
    must(leaks.table.length === 0 && leaks.acl.length === 0 && leaks.fn.length === 0, `${round}: no table/function privilege for anon, authenticated or PUBLIC`);
    must((await one(`SELECT relrowsecurity AND NOT relforcerowsecurity AS rls FROM pg_class WHERE oid='public."TextEmbeddingJob"'::regclass`)).rls === true, `${round}: RLS enabled`);
    must((await one(`SELECT count(*)::int n FROM pg_policies WHERE tablename='TextEmbeddingJob'`)).n === 0, `${round}: no client policies`);
    must((await one(`SELECT count(*)::int n FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE '%text_embedding_job%'`)).n === 4, `${round}: four triggers`);

    const lost = (await one(`INSERT INTO "LostPost"(user_id,title,description,category,location) VALUES(1,'검은 지갑','도서관','지갑','중앙도서관') RETURNING id`)).id;
    must(!(await job("lost", lost)), `${round}: insert queues nothing (creation embeds inline)`);
    await db.query(`UPDATE "LostPost" SET status='found', view_count=view_count+1 WHERE id=$1`, [lost]);
    must(!(await job("lost", lost)), `${round}: status/view change queues nothing`);
    await db.query(`UPDATE "LostPost" SET title=title, location=location WHERE id=$1`, [lost]);
    must(!(await job("lost", lost)), `${round}: same-value write queues nothing`);
    await db.query(`UPDATE "LostPost" SET title='갈색 지갑' WHERE id=$1`, [lost]);
    let j = await job("lost", lost);
    must(j?.generation === 1 && j.state === "pending" && j.attempts === 0, `${round}: title change queues generation 1`);
    await db.query(`UPDATE "TextEmbeddingJob" SET state='failed',attempts=5 WHERE post_type='lost' AND post_id=$1`, [lost]);
    await db.query(`UPDATE "LostPost" SET location=NULL WHERE id=$1`, [lost]);
    j = await job("lost", lost);
    must(j?.generation === 2 && j.state === "pending" && j.attempts === 0, `${round}: a new edit re-arms a failed job with a new generation`);
    const found = (await one(`INSERT INTO "FoundPost"(user_id,title,description,category) VALUES(1,'우산','강의실','기타') RETURNING id`)).id;
    await db.query(`UPDATE "FoundPost" SET description='공학관 강의실', category='생활용품' WHERE id=$1`, [found]);
    must((await job("found", found))?.generation === 1, `${round}: found post change queues once per statement`);
    must((await job("lost", lost))?.generation === 2, `${round}: a found post change leaves the lost job (same id space) untouched`);
    await db.query(`DELETE FROM "LostPost" WHERE id=$1`, [lost]);
    await db.query(`DELETE FROM "FoundPost" WHERE id=$1`, [found]);
    must((await one(`SELECT count(*)::int n FROM "TextEmbeddingJob"`)).n === 0, `${round}: delete removes the job`);

    if (round === "apply") {
      const keep = (await one(`INSERT INTO "LostPost"(user_id,title,description,category) VALUES(2,'보존','기존 행','기타') RETURNING id`)).id;
      await db.query(rollback);
      must((await one(`SELECT to_regclass('public."TextEmbeddingJob"') IS NULL AND to_regprocedure('public.queue_text_embedding()') IS NULL AS gone`)).gone === true, "rollback removes table and function");
      must((await one(`SELECT count(*)::int n FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE '%text_embedding_job%'`)).n === 0, "rollback removes triggers");
      must((await one(`SELECT title FROM "LostPost" WHERE id=$1`, [keep]))?.title === "보존", "rollback keeps post rows");
      await db.query(`UPDATE "LostPost" SET title='보존 수정' WHERE id=$1`, [keep]);
      must(true, "post edits work after rollback");
    }
  }
  console.log(JSON.stringify({ suite: "text-job-migration-local", passed: results.length }));
} finally {
  await db.end().catch(() => {});
}
