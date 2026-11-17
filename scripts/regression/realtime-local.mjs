// Local PostgreSQL authorization/concurrency model; no hosted credentials.
import "../db/install-guard.mjs";
import {Client} from "pg";
import {randomUUID} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {prepareLocalRealtimeModel,captureRealtimeAuthorization,rebuildLocalRealtimeAuthorization} from "../backup/realtime-authorization.mjs";
const port=process.env.MJU_REALTIME_TEST_PORT;
if(!/^\d+$/.test(port??""))throw new Error("Isolated local test port required");
const db=new Client({connectionString:`postgresql://postgres@127.0.0.1:${port}/postgres`});
const sender=new Client({connectionString:`postgresql://postgres@127.0.0.1:${port}/postgres`});
const writer=new Client({connectionString:`postgresql://postgres@127.0.0.1:${port}/postgres`});
let count=0;
const must=(ok,name)=>{if(!ok)throw new Error(name);count++;};
const scalar=async(sql,args)=>(await db.query(sql,args)).rows[0];
const sid=randomUUID(),grant=randomUUID();
try{
  await Promise.all([db.connect(),sender.connect(),writer.connect()]);
  must((await scalar(`SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'`)).n===0,"Fresh local database required");
  await db.query(`CREATE TABLE "User"(id int PRIMARY KEY,email text,user_type text,deleted_at timestamp);
    CREATE TABLE "ChatRoom"(id int PRIMARY KEY,initiator_user_id int,counterpart_user_id int,organization_id int);
    CREATE TABLE "OrganizationMember"(id int PRIMARY KEY,organization_id int,user_id int,role text);
    CREATE TABLE "ExternalAccessGrant"(id int PRIMARY KEY,email text,status text);
    CREATE TABLE "AppSettings"(id int PRIMARY KEY,google_test_mode_enabled boolean);
    INSERT INTO "User" VALUES(1,'one@example.invalid','student',NULL),(2,'two@example.invalid','student',NULL),(3,'other@example.invalid','student',NULL),(4,'external@example.invalid','external_verified',NULL),(5,'test@example.invalid','external_test',NULL);
    INSERT INTO "ChatRoom" VALUES(10,1,2,NULL),(11,1,NULL,20),(12,1,4,NULL),(13,1,5,NULL);
    INSERT INTO "OrganizationMember" VALUES(1,20,2,'leader'),(2,20,3,'member');
    INSERT INTO "AppSettings" VALUES(1,false);`);
  await prepareLocalRealtimeModel(db);
  for(const name of readdirSync("prisma/migrations").filter(n=>/^20261123\d+_chat_realtime_/.test(n)).sort())await db.query(readFileSync(`prisma/migrations/${name}/migration.sql`,"utf8"));
  for(const [user,room,allowed] of [[1,10,true],[2,10,true],[3,10,false],[2,11,true],[3,11,false],[4,12,false],[5,13,false]])must((await scalar("SELECT mju_chat_member_allowed($1,$2) allowed",[user,room])).allowed===allowed,"Membership mismatch");
  await db.query(`INSERT INTO "ExternalAccessGrant" VALUES(1,'external@example.invalid','active');`);
  must((await scalar("SELECT mju_chat_member_allowed(4,12) allowed")).allowed,"Mapped external label denied");
  await db.query(`UPDATE "AppSettings" SET google_test_mode_enabled=true WHERE id=1`);
  must((await scalar("SELECT mju_chat_member_allowed(5,13) allowed")).allowed,"Test mode mapped label denied");
  await db.query(`UPDATE "ChatRealtimeConfig" SET mode='private',project_ref='local-preview',signing_kid=$1`,[randomUUID()]);
  async function seed(user=2,room=11){
    await db.query(`INSERT INTO "ChatRealtimeSession"(id,user_id,expires_at) VALUES($1,$2,(now() AT TIME ZONE 'UTC')+interval '1 hour') ON CONFLICT(id) DO UPDATE SET revoked_at=NULL`,[sid,user]);
    await db.query(`INSERT INTO "ChatRealtimeGrant"(id,user_id,session_id,room_id,client_id,expires_at) VALUES($1,$2,$3,$4,$3,(now() AT TIME ZONE 'UTC')+interval '2 min') ON CONFLICT(id) DO UPDATE SET revoked_at=NULL`,[grant,user,sid,room]);
  }
  await seed();
  const epoch=Math.floor(Date.now()/1000),claims={role:"mju_chat_realtime",scope:"mju.chat.receive.v1",aud:"mju-realtime",exp:epoch+120,iat:epoch,nbf:epoch-5,grant_id:grant,sub:grant,app_user_id:2,room_id:11,auth_sid:sid,project:"local-preview",iss:"https://local-preview.supabase.co/auth/v1"};
  await db.query(`INSERT INTO realtime.messages VALUES($1,'broadcast'),($1,'presence'),('other','broadcast')`,[`mju-chat:${grant}`]);
  async function receive(value=claims,topic=`mju-chat:${grant}`){
    await db.query("BEGIN");try{
      await db.query(`SELECT set_config('request.jwt.claims',$1,true),set_config('realtime.topic',$2,true)`,[JSON.stringify(value),topic]);
      await db.query("SET LOCAL ROLE mju_chat_realtime");
      const rows=(await db.query("SELECT * FROM realtime.messages")).rows;return rows.length;
    }finally{await db.query("ROLLBACK");}
  }
  must(await receive()===1,"Private receive policy denied valid session");
  for(const patch of [{role:"anon"},{scope:"other"},{aud:"authenticated"},{exp:epoch-1},{exp:undefined},{iat:undefined},{nbf:undefined},{exp:epoch+600},{room_id:10},{app_user_id:3},{auth_sid:randomUUID()},{grant_id:randomUUID()},{project:"production"},{iss:"https://production.supabase.co/auth/v1"}])must(await receive({...claims,...patch})===0,"Invalid claims accepted");
  must(await receive(claims,"chat-room-11")===0,"Public topic accepted");
  await db.query("BEGIN; SET LOCAL ROLE mju_chat_realtime");
  try{await db.query(`INSERT INTO realtime.messages VALUES('forged','broadcast')`);throw new Error("Client INSERT accepted");}catch(e){must(e.code==="42501","Expected receive-only INSERT denial");}finally{await db.query("ROLLBACK");}
  await db.query("BEGIN; SET LOCAL ROLE mju_chat_realtime");
  try{await db.query(`SELECT * FROM "User"`);throw new Error("App table access accepted");}catch(e){must(e.code==="42501","Unexpected app table permission");}finally{await db.query("ROLLBACK");}
  // A membership revocation must wait for admitted in-flight dispatch, and
  // deny any dispatch/receive admitted after the revocation commits.
  await sender.query("BEGIN");await sender.query(`SELECT id FROM "ChatRealtimeSession" WHERE id=$1 FOR SHARE`,[sid]);
  await sender.query(`SELECT id FROM "ChatRealtimeGrant" WHERE id=$1 FOR SHARE`,[grant]);
  let revoked=false;
  const revocation=writer.query(`UPDATE "OrganizationMember" SET role='member' WHERE id=1`).then(()=>{revoked=true;});
  await new Promise(r=>setTimeout(r,100));must(!revoked,"Revocation did not serialize with dispatch");
  await sender.query("COMMIT");await revocation;
  must(await receive()===0,"Connected grant survived committed revocation");
  must((await scalar(`SELECT revoked_at IS NOT NULL revoked FROM "ChatRealtimeGrant" WHERE id=$1`,[grant])).revoked,"Grant tombstone missing");
  await db.query(`UPDATE "OrganizationMember" SET role='leader' WHERE id=1`);
  must(await receive()===0,"Old token resurrected after re-approval");
  // Account withdrawal and logout both invalidate still-connected topics.
  await seed();await db.query(`UPDATE "User" SET deleted_at=now() WHERE id=2`);
  must(await receive()===0,"Withdrawn session accepted");
  await db.query(`UPDATE "User" SET deleted_at=NULL WHERE id=2`);await seed();
  await db.query(`UPDATE "ChatRealtimeSession" SET revoked_at=now() WHERE id=$1`,[sid]);
  must(await receive()===0,"Logged-out session accepted");
  async function externalFixture(user,room){
    const session=randomUUID(),lease=randomUUID();
    await db.query(`INSERT INTO "ChatRealtimeSession"(id,user_id,expires_at) VALUES($1,$2,(now() AT TIME ZONE 'UTC')+interval '1 hour')`,[session,user]);
    await db.query(`INSERT INTO "ChatRealtimeGrant"(id,user_id,session_id,room_id,client_id,expires_at) VALUES($1,$2,$3,$4,$3,(now() AT TIME ZONE 'UTC')+interval '2 min')`,[lease,user,session,room]);
    return lease;
  }
  const external=await externalFixture(4,12);
  await db.query(`UPDATE "ExternalAccessGrant" SET email='renamed@example.invalid' WHERE id=1`);
  must((await scalar(`SELECT revoked_at IS NOT NULL revoked FROM "ChatRealtimeGrant" WHERE id=$1`,[external])).revoked,"Email change failed to revoke old identity");
  await db.query(`UPDATE "ExternalAccessGrant" SET email='external@example.invalid' WHERE id=1`);
  const approval=await externalFixture(4,12);
  await db.query(`UPDATE "ExternalAccessGrant" SET status='revoked' WHERE id=1`);
  must((await scalar(`SELECT revoked_at IS NOT NULL revoked FROM "ChatRealtimeGrant" WHERE id=$1`,[approval])).revoked,"Approval revocation failed");
  const testMode=await externalFixture(5,13);
  await db.query(`UPDATE "AppSettings" SET google_test_mode_enabled=false WHERE id=1`);
  must((await scalar(`SELECT revoked_at IS NOT NULL revoked FROM "ChatRealtimeGrant" WHERE id=$1`,[testMode])).revoked,"Test mode revocation failed");
  // A polling transition must wait for token admission's config lock, then
  // revoke even a grant inserted after the transition started waiting.
  const racingSession=randomUUID(),racingGrant=randomUUID();
  await sender.query("BEGIN");
  await sender.query(`SELECT mode FROM "ChatRealtimeConfig" WHERE id=true FOR SHARE`);
  await writer.query("BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");
  let switched=false;
  const transition=writer.query(`UPDATE "ChatRealtimeConfig" SET mode='polling' WHERE id=true`)
    .then(()=>{switched=true;return null;},error=>error);
  const waitDeadline=Date.now()+2000;
  let waiting=false;
  while(Date.now()<waitDeadline){
    waiting=(await scalar(`SELECT wait_event_type='Lock' waiting FROM pg_stat_activity WHERE pid=$1`,[writer.processID]))?.waiting===true;
    if(waiting)break;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  must(waiting&&!switched,"Mode transition bypassed token admission lock");
  await sender.query(`INSERT INTO "ChatRealtimeSession"(id,user_id,expires_at) VALUES($1,2,(now() AT TIME ZONE 'UTC')+interval '1 hour')`,[racingSession]);
  await sender.query(`INSERT INTO "ChatRealtimeGrant"(id,user_id,session_id,room_id,client_id,expires_at) VALUES($1,2,$2,11,$2,(now() AT TIME ZONE 'UTC')+interval '2 min')`,[racingGrant,racingSession]);
  await sender.query("COMMIT");
  const transitionError=await transition;
  if(transitionError)throw transitionError;
  await writer.query(`UPDATE "ChatRealtimeGrant" SET revoked_at=now() AT TIME ZONE 'UTC' WHERE revoked_at IS NULL`);
  await writer.query("COMMIT");
  must(switched,"Mode transition did not resume after admission commit");
  must((await scalar(`SELECT mode FROM "ChatRealtimeConfig" WHERE id=true`)).mode==="polling","Polling mode not committed");
  must((await scalar(`SELECT revoked_at IS NOT NULL revoked FROM "ChatRealtimeGrant" WHERE id=$1`,[racingGrant])).revoked,"Concurrent admitted grant escaped transition revocation");
  const racingClaims={...claims,sub:racingGrant,grant_id:racingGrant,auth_sid:racingSession};
  await db.query(`INSERT INTO realtime.messages VALUES($1,'broadcast')`,[`mju-chat:${racingGrant}`]);
  must(await receive(racingClaims,`mju-chat:${racingGrant}`)===0,"Concurrent grant accepted after polling transition");
  await db.query(`UPDATE "ChatRealtimeConfig" SET mode='private' WHERE id=true`);
  must(await receive(racingClaims,`mju-chat:${racingGrant}`)===0,"Mode re-enable resurrected a transition-revoked grant");
  // Backup metadata must preserve the actual receive-only privileges, not
  // just table contents. Rebuild removed ACL/policy and compare exactly.
  const expected=await captureRealtimeAuthorization(db);
  await db.query(`DROP POLICY mju_chat_private_receive ON realtime.messages;REVOKE SELECT ON realtime.messages FROM mju_chat_realtime;`);
  await rebuildLocalRealtimeAuthorization(db,expected);
  must(JSON.stringify(await captureRealtimeAuthorization(db))===JSON.stringify(expected),"Authorization rebuild mismatch");
  console.log(JSON.stringify({suite:"D3 local SQL authorization and revocation",passed:count,hostedRealtimeVerified:false}));
}finally{
  await Promise.allSettled([db.query("ROLLBACK"),sender.query("ROLLBACK"),writer.query("ROLLBACK")]);
  await Promise.allSettled([db.end(),sender.end(),writer.end()]);
}
