import {afterEach,expect,it,vi} from "vitest";
const RealtimeClient=vi.fn(function(...args:[string,unknown]){return {args};});
vi.mock("@supabase/realtime-js",()=>({RealtimeClient}));
const {createChatRealtimeClient}=await import("./realtimeBrowser");
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
it("creates isolated transports with public API configuration only",()=>{
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://preview.example.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY","public-anon");
  vi.stubEnv("MJU_REALTIME_PRIVATE_JWK","server-private-sentinel");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","server-service-sentinel");
  const a=createChatRealtimeClient(),b=createChatRealtimeClient();expect(a).not.toBe(b);
  expect(RealtimeClient).toHaveBeenCalledWith("https://preview.example.invalid/realtime/v1",expect.objectContaining({params:{apikey:"public-anon"}}));
  expect(JSON.stringify(RealtimeClient.mock.calls)).not.toContain("server-");
});
it("supports the existing publishable-key configuration and bounded reconnect delay",()=>{
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY",undefined);vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY","public-publishable");
  createChatRealtimeClient();const config=RealtimeClient.mock.calls[0][1] as unknown as {params:{apikey:string};reconnectAfterMs:(n:number)=>number};
  expect(config.params.apikey).toBe("public-publishable");expect(config.reconnectAfterMs(1)).toBe(5000);expect(config.reconnectAfterMs(100)).toBe(30000);
});
