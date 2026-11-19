import {afterEach,beforeEach,expect,it,vi} from "vitest";
const $queryRaw=vi.fn(),$executeRaw=vi.fn(),txQuery=vi.fn(),txExecute=vi.fn();
const $transaction=vi.fn(async(fn:(tx:unknown)=>unknown)=>fn({$queryRaw:txQuery,$executeRaw:txExecute}));
vi.mock("@/lib/db/prisma",()=>({prisma:{$queryRaw,$executeRaw,$transaction}}));
const checkRateLimit=vi.fn(),rateLimitTierFor=vi.fn(),signRealtimeGrant=vi.fn(),signingConfiguration=vi.fn();
vi.mock("@/lib/rateLimit",()=>({checkRateLimit,rateLimitTierFor}));
vi.mock("./realtimeToken",async()=>({...await vi.importActual<typeof import("./realtimeToken")>("./realtimeToken"),signRealtimeGrant,signingConfiguration}));
const {issueChatRealtimeGrant,withAuthorizedChatRealtimeTopic,cleanExpiredChatRealtimeGrants,authorizeChatRealtimeReceipt}=await import("./realtimeGrants");
const sid="c98a3c0a-92d8-4856-a4ab-998d185190ab",id="b4c4033b-c716-4a55-875b-ad526474ce44",project="swqvlihgupranzfzjevb";
const user={id:7,isAdmin:false,userType:"STUDENT"} as Parameters<typeof issueChatRealtimeGrant>[0];
let allowed=true,active=false,existing=false,capacity=0;
beforeEach(()=>{
  vi.clearAllMocks();allowed=true;active=false;existing=false;capacity=0;
  signingConfiguration.mockReturnValue({project,kid:id});signRealtimeGrant.mockResolvedValue("ephemeral");
  checkRateLimit.mockResolvedValue({ok:true});rateLimitTierFor.mockResolvedValue("user");
  $queryRaw.mockImplementation(async(strings:TemplateStringsArray)=>strings.join().includes("mju_chat_member_allowed")?[{allowed:true}]:[{mode:"private",project_ref:project,signing_kid:id}]);
  txQuery.mockImplementation(async(strings:TemplateStringsArray)=>{
    const sql=strings.join("?");
    if(sql.includes('FROM "ChatRealtimeConfig"'))return [{mode:"private",project_ref:project,signing_kid:id}];
    if(sql.includes("mju_chat_member_allowed")&&sql.startsWith("SELECT public"))return [{allowed}];
    if(sql.includes('INSERT INTO "ChatRealtimeSession"'))return [{id:sid}];
    if(sql.includes('INSERT INTO "ChatRealtimeGrant"'))return [{id}];
    if(sql.includes("count(*)"))return [{n:capacity}];
    if(sql.includes("AS active"))return existing?[{id,active}]:[];
    return [];
  });
});
const issue=(seconds=3600)=>issueChatRealtimeGrant(user,{id:sid,expiresAt:Math.floor(Date.now()/1000)+seconds},10);
afterEach(()=>vi.unstubAllEnvs());
it("restricts issuance to the configured room and keeps unauthorized rooms forbidden",async()=>{
  vi.stubEnv("MJU_REALTIME_CANARY_ROOM_ID","11");
  expect(await issue()).toEqual({kind:"polling"});
  $queryRaw.mockResolvedValueOnce([{allowed:false}]);
  expect(await issue()).toEqual({kind:"forbidden"});
  vi.stubEnv("MJU_REALTIME_CANARY_ROOM_ID","malformed");
  expect(await issue()).toEqual({kind:"polling"});
  expect($transaction).not.toHaveBeenCalled();
});
it("accepts a receipt only with an active session and room grant in the canary",async()=>{
  expect(await authorizeChatRealtimeReceipt(user,sid,10)).toEqual({kind:"forbidden"});
  expect($queryRaw).not.toHaveBeenCalled();
  vi.stubEnv("MJU_REALTIME_CANARY_ROOM_ID","10");
  $queryRaw.mockResolvedValueOnce([{allowed:false}]).mockResolvedValueOnce([{allowed:true}]);
  expect(await authorizeChatRealtimeReceipt(user,sid,10)).toEqual({kind:"forbidden"});
  expect(await authorizeChatRealtimeReceipt(user,sid,10)).toBe("ok");
  expect($queryRaw.mock.lastCall?.[0].join("?")).toContain("mju_chat_member_allowed");
  expect($executeRaw).not.toHaveBeenCalled();
  expect($transaction).not.toHaveBeenCalled();
});
it("caps the JWT to the original cookie expiry and locks admission per user",async()=>{
  const result=await issue(60);expect(result.kind).toBe("ok");
  expect(signRealtimeGrant).toHaveBeenCalledWith(expect.objectContaining({id,userId:7,roomId:10,sessionId:sid,expiresAt:expect.any(Date)}));
  const exp=signRealtimeGrant.mock.calls[0][0].expiresAt.getTime();expect(exp-Date.now()).toBeLessThanOrEqual(60000);
  expect(txExecute.mock.calls[0][0].join("?")).toContain("pg_advisory_xact_lock(184219,?)");
});
it("refuses missing config and quota/backend failures without creating grants",async()=>{
  $queryRaw.mockResolvedValueOnce([{allowed:true}]).mockResolvedValueOnce([]);expect((await issue()).kind).toBe("unavailable");
  for(const reason of ["limited","unavailable"]){checkRateLimit.mockResolvedValueOnce({ok:false,reason,retryAfterSeconds:5});expect(await issue()).toMatchObject({kind:"limited",admission:{reason}});}
  expect($transaction).not.toHaveBeenCalled();
});
it("reports deliberate polling without loading the signing key or creating grants",async()=>{
  $queryRaw.mockResolvedValueOnce([{allowed:true}]).mockResolvedValueOnce([{mode:"polling"}]);
  expect(await issue()).toEqual({kind:"polling"});
  expect(signingConfiguration).not.toHaveBeenCalled();expect($transaction).not.toHaveBeenCalled();
});
it("limits requests before missing-key, polling or forbidden-room branches",async()=>{
  signingConfiguration.mockImplementationOnce(()=>{throw new Error("missing key");});
  expect((await issue()).kind).toBe("unavailable");expect(checkRateLimit).toHaveBeenCalledTimes(1);
  checkRateLimit.mockResolvedValueOnce({ok:false,reason:"limited",retryAfterSeconds:30});
  $queryRaw.mockClear();expect((await issue()).kind).toBe("limited");expect($queryRaw).not.toHaveBeenCalled();
  $queryRaw.mockResolvedValueOnce([{allowed:false}]);expect((await issue()).kind).toBe("forbidden");
  expect(checkRateLimit).toHaveBeenCalledTimes(3);
});
it("rechecks current membership inside admission rather than trusting the route",async()=>{
  allowed=false;expect((await issue()).kind).toBe("forbidden");expect(signRealtimeGrant).not.toHaveBeenCalled();
  expect(txQuery.mock.calls.some(c=>c[0].join().includes('INSERT INTO "ChatRealtimeGrant"'))).toBe(false);
});
it("cannot bypass capacity by reactivating an expired/revoked existing grant",async()=>{
  existing=true;active=false;capacity=10;expect(await issue()).toMatchObject({kind:"limited"});expect(signRealtimeGrant).not.toHaveBeenCalled();
  active=true;expect((await issue()).kind).toBe("ok");
});
it("does not extend expired cookies or sign beyond the two-minute lease",async()=>{
  expect((await issue(-1)).kind).toBe("forbidden");expect($transaction).not.toHaveBeenCalled();
  await issue();expect(signRealtimeGrant.mock.calls[0][0].expiresAt.getTime()-Date.now()).toBeLessThanOrEqual(120000);
});
it("does not dispatch a removed grant; authorizes only while row locks are held",async()=>{
  const send=vi.fn();await withAuthorizedChatRealtimeTopic(10,`mju-chat:${id}`,send);expect(send).not.toHaveBeenCalled();
  const queries=txQuery.mock.calls.map(c=>c[0].join("?"));expect(queries[0]).toContain('"ChatRealtimeConfig"');expect(queries[1]).toContain("FOR SHARE");expect(queries[2]).toContain("FOR SHARE OF g");
  txQuery.mockResolvedValueOnce([{mode:"private"}]).mockResolvedValueOnce([{id:sid}]).mockResolvedValueOnce([{id}]);await withAuthorizedChatRealtimeTopic(10,`mju-chat:${id}`,send);expect(send).toHaveBeenCalledTimes(1);
  expect($transaction).toHaveBeenLastCalledWith(expect.any(Function),{maxWait:2000,timeout:5000});
});
it("rejects a runtime switch or key change between initial lookup and admission",async()=>{
  txQuery.mockResolvedValueOnce([{mode:"polling",project_ref:project,signing_kid:id}]);
  expect((await issue()).kind).toBe("polling");
  txQuery.mockResolvedValueOnce([{mode:"private",project_ref:project,signing_kid:sid}]);
  expect((await issue()).kind).toBe("unavailable");expect(signRealtimeGrant).not.toHaveBeenCalled();
  expect(txExecute).not.toHaveBeenCalled();
});
it("cleans only expired metadata with separate commits to avoid session/grant lock inversion",async()=>{
  await cleanExpiredChatRealtimeGrants();expect($transaction).not.toHaveBeenCalled();
  expect($executeRaw).toHaveBeenCalledTimes(2);
  expect($executeRaw.mock.calls[0][0].join()).toContain("interval '1 day'");
  expect($executeRaw.mock.calls[1][0].join()).toContain("NOT EXISTS");
});
