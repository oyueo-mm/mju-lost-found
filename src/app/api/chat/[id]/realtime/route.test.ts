import {NextRequest} from "next/server";
import {beforeEach,expect,it,vi} from "vitest";
const auth=vi.fn(),getCurrentUser=vi.fn(),issueChatRealtimeGrant=vi.fn();
const authorizeChatRealtimeReceipt=vi.fn(),realtimeCanaryRoom=vi.fn(),authorizeChatRealtimeDiagnostic=vi.fn();
vi.mock("@/lib/auth/auth",()=>({auth}));
vi.mock("@/lib/auth/session",()=>({getCurrentUser}));
vi.mock("@/lib/chat/realtimeGrants",async(importOriginal)=>{const actual=await importOriginal<typeof import("@/lib/chat/realtimeGrants")>();return {issueChatRealtimeGrant,authorizeChatRealtimeReceipt,realtimeCanaryRoom,authorizeChatRealtimeDiagnostic,isRealtimeDiagEvent:actual.isRealtimeDiagEvent};});
const {POST}=await import("./route");
const sid="c98a3c0a-92d8-4856-a4ab-998d185190ab";
const call=(headers:Record<string,string>={origin:"http://localhost"},id="10")=>POST(new NextRequest(`http://localhost/api/chat/${id}/realtime`,{method:"POST",headers}),{params:Promise.resolve({id})});
beforeEach(()=>{
  vi.resetAllMocks();getCurrentUser.mockResolvedValue({id:7,isAdmin:false});
  auth.mockResolvedValue({user:{id:"7"},realtimeSessionId:sid,authExpiresAt:123456});
  issueChatRealtimeGrant.mockResolvedValue({kind:"ok",token:"ephemeral",topic:"mju-chat:grant",expiresAt:"future",grantId:"internal"});
});
it("rejects missing/cross origin and cross-site before authentication",async()=>{
  for(const headers of [{},{origin:"https://attacker.invalid"},{origin:"http://localhost","sec-fetch-site":"cross-site"}] as Record<string,string>[]){
    const res=await call(headers);expect(res.status).toBe(403);expect(res.headers.get("cache-control")).toContain("no-store");
  }expect(getCurrentUser).not.toHaveBeenCalled();
});
it("requires a current user and positive room ID",async()=>{
  getCurrentUser.mockResolvedValueOnce(null);expect((await call()).status).toBe(401);
  for(const id of ["0","-1","NaN","9007199254740992"])expect((await call(undefined,id)).status).toBe(400);
  expect(issueChatRealtimeGrant).not.toHaveBeenCalled();
});
it("does not let an administrator bypass participation",async()=>{
  getCurrentUser.mockResolvedValue({id:7,isAdmin:true});issueChatRealtimeGrant.mockResolvedValue({kind:"forbidden"});
  expect((await call()).status).toBe(403);
  expect(issueChatRealtimeGrant).toHaveBeenCalledWith({id:7,isAdmin:true},{id:sid,expiresAt:123456},10);
});
it("requires persistent session bootstrap and rejects a mismatched identity",async()=>{
  auth.mockResolvedValueOnce({user:{id:"7"},realtimeSessionNeedsRefresh:true,realtimeSessionId:sid});expect((await call()).status).toBe(409);
  auth.mockResolvedValueOnce({user:{id:"8"},realtimeSessionId:sid,authExpiresAt:123});expect((await call()).status).toBe(401);
  expect(issueChatRealtimeGrant).not.toHaveBeenCalled();
});
it("binds issuance to the server room/user and actual cookie expiry; forbids caching",async()=>{
  const res=await call();expect(res.status).toBe(200);
  expect(issueChatRealtimeGrant).toHaveBeenCalledWith({id:7,isAdmin:false},{id:sid,expiresAt:123456},10);
  expect(res.headers.get("cache-control")).toBe("private, no-store, max-age=0");expect(res.headers.get("vary")).toBe("Cookie");
  expect(await res.json()).toEqual({token:"ephemeral",topic:"mju-chat:grant",expiresAt:"future",userId:7,roomId:10});
});
it("distinguishes quota, counter failure, revoked access and missing signing configuration",async()=>{
  for(const [issued,status] of [[{kind:"limited",admission:{ok:false,reason:"limited",retryAfterSeconds:30}},429],[{kind:"limited",admission:{ok:false,reason:"unavailable",retryAfterSeconds:5}},503],[{kind:"forbidden"},403],[{kind:"unavailable"},503]] as const){
    issueChatRealtimeGrant.mockResolvedValueOnce(issued);const res=await call();expect(res.status).toBe(status);expect(res.headers.get("cache-control")).toContain("no-store");
  }
});
it("signals deliberate polling with an empty, uncacheable 204",async()=>{
  issueChatRealtimeGrant.mockResolvedValueOnce({kind:"polling"});
  const res=await call();expect(res.status).toBe(204);expect(await res.text()).toBe("");
  expect(res.headers.get("cache-control")).toContain("no-store");
  // open tabs re-check later, so enabling private mode reaches them without a reload
  expect(res.headers.get("retry-after")).toBe("120");
});
it("advertises receipts only for the designated room, reports a digest, and never issues a token for a receipt",async()=>{
  realtimeCanaryRoom.mockReturnValue(10);
  expect(await (await call()).json()).toMatchObject({receiptEnabled:true});
  issueChatRealtimeGrant.mockClear();
  const receipt={origin:"http://localhost","x-mju-realtime-receipt":sid};
  expect((await call({...receipt,"x-mju-realtime-receipt":"bad"})).status).toBe(400);
  expect(authorizeChatRealtimeReceipt).not.toHaveBeenCalled();
  authorizeChatRealtimeReceipt.mockResolvedValueOnce({kind:"forbidden"}).mockResolvedValueOnce("ok");
  const log=vi.spyOn(console,"info").mockImplementation(()=>{});
  try {
    expect((await call(receipt)).status).toBe(403);
    expect(log).not.toHaveBeenCalled();
    expect((await call(receipt)).status).toBe(204);
    expect(log).toHaveBeenCalledWith("Private chat browser receipt",expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(authorizeChatRealtimeReceipt).toHaveBeenCalledWith({id:7,isAdmin:false},sid,10);
    expect(issueChatRealtimeGrant).not.toHaveBeenCalled();
  } finally {log.mockRestore();}
});
it("accepts only fixed canary diagnostics from members and logs no identity or content",async()=>{
  const diag=(event:string)=>call({origin:"http://localhost","x-mju-realtime-diag":event});
  expect((await diag("hello <script>")).status).toBe(400);
  expect(authorizeChatRealtimeDiagnostic).not.toHaveBeenCalled();
  authorizeChatRealtimeDiagnostic.mockResolvedValueOnce({kind:"forbidden"}).mockResolvedValueOnce("ok");
  const log=vi.spyOn(console,"info").mockImplementation(()=>{});
  try {
    expect((await diag("hidden-connected")).status).toBe(403);
    expect(log).not.toHaveBeenCalled();
    expect((await diag("polling-mode")).status).toBe(204);
    expect(log).toHaveBeenCalledWith("Chat realtime diag","polling-mode","room",10,"participant",expect.stringMatching(/^[0-9a-f]{8}$/));
    expect(JSON.stringify(log.mock.calls)).not.toContain(sid);
    expect(authorizeChatRealtimeDiagnostic).toHaveBeenCalledWith({id:7,isAdmin:false},10);
    expect(issueChatRealtimeGrant).not.toHaveBeenCalled();
  } finally {log.mockRestore();}
});
it("fails closed on unexpected database errors without leaking diagnostics",async()=>{
  issueChatRealtimeGrant.mockRejectedValueOnce(new Error("sensitive connection details"));const res=await call();expect(res.status).toBe(503);expect(await res.text()).not.toContain("sensitive");
});
