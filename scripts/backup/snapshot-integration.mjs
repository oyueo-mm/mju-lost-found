// Local isolated PostgreSQL only. Called by snapshot-integration.sh.
import "../db/install-guard.mjs";
import { Client } from "pg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { withBackupSnapshot } from "./snapshot.mjs";
const exec = promisify(execFile);
const port = process.env.MJU_SNAPSHOT_TEST_PORT;
if (!/^\d+$/.test(port ?? "")) throw new Error("Local test port required");
const url = `postgresql://postgres@127.0.0.1:${port}/postgres`;
const out = process.env.MJU_SNAPSHOT_TEST_DIR;
const run = (name,args) => exec(`${process.env.PG_BIN}/${name}`,args);
const db = new Client({connectionString:url}), writer = new Client({connectionString:url});
await db.connect(); await writer.connect();
try {
  await db.query("CREATE TABLE fixture(id int PRIMARY KEY, value text); INSERT INTO fixture VALUES(1,'old'),(2,'delete')");
  await run("pg_dump",[url,"-Fc","-n","public","-f",`${out}/old.dump`]);
  await writer.query("BEGIN; UPDATE fixture SET value='changed' WHERE id=1; DELETE FROM fixture WHERE id=2; INSERT INTO fixture VALUES(3,'new'),(4,'new'); COMMIT");
  const later = Number((await db.query("SELECT count(*) n FROM fixture")).rows[0].n);
  async function restored(file, name) {
    await run("createdb",["-h","127.0.0.1","-p",port,"-U","postgres",name]);
    const target=`postgresql://postgres@127.0.0.1:${port}/${name}`;
    if (!file.endsWith("/full.dump")) await run("psql",[target,"-c","DROP SCHEMA public"]);
    await run("pg_restore",["--no-owner","--no-privileges","--exit-on-error","-d",target,file]);
    const c=new Client({connectionString:target}); await c.connect();
    try { return (await c.query("SELECT id,value FROM fixture ORDER BY id")).rows; } finally { await c.end(); }
  }
  const old=await restored(`${out}/old.dump`,"old_verify");
  if (old.length === later) throw new Error("Historical race not reproduced");
  console.log(JSON.stringify({check:"historical mismatch reproduced",dumpRows:old.length,laterRows:later,passed:true}));
  let expected;
  await withBackupSnapshot(db, async (snapshot, signal) => {
    expected=(await db.query("SELECT id,value FROM fixture ORDER BY id")).rows;
    await writer.query("BEGIN; UPDATE fixture SET value='later' WHERE id=1; DELETE FROM fixture WHERE id=4; INSERT INTO fixture VALUES(5,'later'),(6,'later'); COMMIT");
    for(const [name,args] of [["full",[]],["public",["-n","public"]]]) {
      await exec(`${process.env.PG_BIN}/pg_dump`,[url,"--snapshot",snapshot,"-Fc",...args,"-f",`${out}/${name}.dump`],{signal});
      const rows=await restored(`${out}/${name}.dump`,`${name}_verify`);
      if(JSON.stringify(rows)!==JSON.stringify(expected))throw new Error("Snapshot data mismatch");
    }
    const options=(await db.query("SHOW transaction_isolation")).rows[0];
    console.log(JSON.stringify({check:"shared snapshot survives concurrent insert/update/delete",dumps:2,rows:expected.length,isolation:Object.values(options)[0],passed:true}));
  });
  try { await withBackupSnapshot(db,async()=>{throw new Error("simulated dump failure");}); } catch {}
  await db.query("BEGIN READ ONLY; SELECT 1; ROLLBACK");
  console.log(JSON.stringify({check:"failed dump releases transaction",passed:true}));
} finally { await db.end(); await writer.end(); }
