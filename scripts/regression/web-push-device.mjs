// Actual browser/provider push on this Windows device with an empty local DB.
// No hosted credentials, shared outbox sweep, exported endpoints or payloads.
import "../db/install-guard.mjs";
import {spawn,spawnSync} from "node:child_process";
import {once} from "node:events";
import {createServer} from "node:net";
import {randomUUID} from "node:crypto";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createRequire} from "node:module";
import {Client} from "pg";
import {createJiti} from "jiti";
import webpush from "web-push";

const socketPath=process.argv[3]??"";
if(process.platform!=="win32"||process.argv.length!==4||process.argv[2]!=="--isolated-local-postgres"||
  !/^\/home\/[\w.-]+\/\.cache\/mjufind-web-push-test\/run\.[A-Za-z0-9]{6}\/\.s\.PGSQL\.55447$/.test(socketPath))throw new Error("Isolated WSL PostgreSQL and Windows Edge required");
const databaseUrl="postgresql://postgres@127.0.0.1:55446/postgres?schema=public";
const base="http://localhost:3105";
const vapid=webpush.generateVAPIDKeys();
const env={...process.env,DATABASE_URL:databaseUrl,DIRECT_URL:databaseUrl,AUTH_SECRET:randomUUID()+randomUUID(),AUTH_TRUST_HOST:"true",
  VERCEL_ENV:"development",MJU_REALTIME_PRIVATE_JWK:"",SUPABASE_SERVICE_ROLE_KEY:"",VAPID_PUBLIC_KEY:vapid.publicKey,VAPID_PRIVATE_KEY:vapid.privateKey,VAPID_SUBJECT:"mailto:qa@example.invalid"};
const query=new Client({connectionString:databaseUrl,connectionTimeoutMillis:5000});
const require=createRequire(import.meta.url);
let server,prisma;
let stage="connect-local-database";
const relayChildren=new Set();
// Use Windows loopback to WSL's private Unix socket without exposing the DB
// on the VM network. The child transports only PostgreSQL protocol bytes.
const bridge=createServer(socket=>{
  const relay=spawn("wsl.exe",["-d","Ubuntu","-e","node","-e",`const c=require('node:net').createConnection(process.argv[1]);process.stdin.pipe(c);c.pipe(process.stdout);c.on('error',()=>process.exit(1));c.on('close',()=>process.exit());`,socketPath],{windowsHide:true});
  relayChildren.add(relay);
  relay.stderr.resume();
  relay.stdin.on("error",()=>socket.destroy());
  relay.once("error",()=>socket.destroy());
  relay.once("close",()=>{relayChildren.delete(relay);socket.destroy();});
  socket.on("error",()=>relay.kill());
  socket.once("close",()=>relay.kill());
  socket.pipe(relay.stdin);
  relay.stdout.pipe(socket);
});

try{
  await new Promise((resolve,reject)=>{bridge.once("error",reject);bridge.listen(55446,"127.0.0.1",resolve);});
  await query.connect();
  stage="validate-local-database";
  const {data_directory:directory}=(await query.query("SHOW data_directory")).rows[0];
  if(!/\/\.cache\/mjufind-web-push-test\/run\.[A-Za-z0-9]{6}\/data$/.test(directory))throw new Error("Refusing a database outside the test runner");
  const fresh=(await query.query("SELECT count(*)::int AS tables FROM pg_tables WHERE schemaname='public'")).rows[0];
  if(fresh.tables!==0)throw new Error("Refusing nonempty local database");
  stage="create-local-schema";
  const setup=spawnSync(process.execPath,["node_modules/prisma/build/index.js","migrate","diff","--from-empty","--to-schema","prisma/schema.prisma","--script","--config","prisma7.config.ts"],{env,encoding:"utf8",windowsHide:true,timeout:90000});
  if(setup.status!==0||setup.error){
    const logs=`${setup.stdout??""}\n${setup.stderr??""}`;
    const code=/\b(?:P\d{4}|ECONNREFUSED|MODULE_NOT_FOUND|ENOENT|EPIPE)\b/.exec(logs)?.[0];
    const pgCode=/\b(?:23502|22P02|42704|42883|42601)\b/.exec(logs)?.[0];
    const diagnostic=logs.split(/\r?\n/).find(line=>/^(?:Error:|error:)/.test(line));
    console.error(JSON.stringify({schemaStatus:setup.status,schemaErrorCode:code,schemaPostgresCode:pgCode,processError:setup.error?.code,
      reason:diagnostic?.includes("database server")?"database-server":diagnostic?.includes("type")?"schema-type":diagnostic?.includes("config")?"config":diagnostic?.includes("engine")?"engine":undefined}));
  }
  if(setup.status!==0||setup.error||!setup.stdout.includes('CREATE TABLE "User"'))throw new Error("Local schema initialization failed");
  await query.query(setup.stdout);
  stage="fixtures";
  process.env.DATABASE_URL=databaseUrl;
  process.env.DIRECT_URL=databaseUrl;
  process.env.VERCEL_ENV="development";
  const jiti=createJiti(import.meta.url,{alias:{"@":fileURLToPath(new URL("../../src",import.meta.url))}});
  ({prisma}=await jiti.import("../../src/lib/db/prisma.ts"));
  const terms=await jiti.import("../../src/lib/auth/terms.ts");
  const {encode}=await import(pathToFileURL(require.resolve("@auth/core/jwt")));
  const users=[],cookies=[];
  for(let i=0;i<2;i++){
    const user=await prisma.user.create({data:{email:`push-${i}@test.example.invalid`,name:"Web push fixture",nickname:`Web push ${i}`,
      privacyConsentAt:new Date(),privacyConsentVersion:terms.CURRENT_PRIVACY_VERSION,termsAcceptedAt:new Date(),termsVersion:terms.CURRENT_TERMS_VERSION,identityConsentVersion:terms.CURRENT_IDENTITY_CONSENT_VERSION}});
    users.push(user);
    await prisma.userIdentityInfo.create({data:{userId:user.id,realName:"Synthetic",department:"Synthetic",consentVersion:terms.CURRENT_IDENTITY_CONSENT_VERSION,consentedAt:new Date()}});
    const token={sub:String(user.id),userId:user.id,nickname:user.nickname,realtimeSessionId:randomUUID()};
    cookies.push(await encode({token,secret:env.AUTH_SECRET,salt:"authjs.session-token"}));
  }
  const room=await prisma.chatRoom.create({data:{initiatorUserId:users[0].id,counterpartUserId:users[1].id,postType:"lost",postTitle:"Web push fixture"}});
  stage="local-app";
  await new Promise((resolve,reject)=>{const probe=createServer();probe.once("error",reject);probe.listen(3105,"127.0.0.1",()=>probe.close(resolve));});
  server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p","3105"],{env,stdio:"ignore",windowsHide:true});
  let ready=false;
  for(let i=0;i<30&&!ready;i++){
    try{ready=(await fetch(base+"/api/version",{signal:AbortSignal.timeout(1000)})).ok;}catch{}
    if(!ready)await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(!ready)throw new Error("Local app unavailable");
  stage="device-browser";
  const browser=spawn("python",["scripts/regression/web-push-device.py"],{stdio:["pipe","pipe","ignore"],timeout:90000,windowsHide:true});
  browser.stdin.end(JSON.stringify({base,cookies,roomId:room.id}));
  let output="";
  browser.stdout.on("data",data=>{output+=data;});
  const [status]=await once(browser,"close");
  if(output)console.log(JSON.stringify(JSON.parse(output)));
  const delivery=await prisma.pushOutbox.findFirst({where:{userId:users[0].id,message:{chatRoomId:room.id}},select:{sentAt:true,attempts:true,lastError:true}});
  const subscriptionRemaining=await prisma.pushSubscription.count({where:{userId:users[0].id}});
  const pushError=/^status (?:\d{3}|network)$/.test(delivery?.lastError??"")?delivery.lastError:undefined;
  console.log(JSON.stringify({sent:!!delivery?.sentAt,attempts:delivery?.attempts,subscriptionRemaining,pushError,localPostgresOnly:true}));
  if(status!==0||!delivery?.sentAt||subscriptionRemaining!==0)throw new Error("Browser delivery receipt or unsubscribe missing");
}catch(error){
  const code=typeof error?.code==="string"&&/^(?:[\dA-Z]{5}|E[A-Z]+)$/.test(error.code)?error.code:undefined;
  console.error(JSON.stringify({failed:true,stage,code}));
  process.exitCode=1;
}finally{
  server?.kill();
  await Promise.allSettled([query.end(),prisma?.$disconnect()]);
  for(const child of relayChildren)child.kill();
  bridge.close();
}
