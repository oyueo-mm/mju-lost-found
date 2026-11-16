import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const httpSend = vi.fn();
const channel = vi.fn(() => ({ httpSend }));
const removeChannel=vi.fn();
const createClient = vi.fn(() => ({ channel,removeChannel }));
const topics=vi.fn(),authorize=vi.fn(async (_room:number,_topic:string,send:()=>Promise<void>)=>send());
vi.mock("./realtimeGrants",()=>({currentChatRealtimeTopics:topics,withAuthorizedChatRealtimeTopic:authorize}));

vi.mock("@supabase/supabase-js", () => ({ createClient }));

const { broadcastChatEvent } = await import("./realtimeAdmin");

const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIGINAL_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

beforeEach(() => {
  vi.clearAllMocks();
  topics.mockResolvedValue(["mju-chat:b4c4033b-c716-4a55-875b-ad526474ce44"]);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
});

afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_KEY;
});

describe("broadcastChatEvent", () => {
  it("sends only to an authorized private grant with a deduplication ID", async () => {
    httpSend.mockResolvedValueOnce({ success: true });

    await broadcastChatEvent(100, { event: "message", payload: { messageId: 7 } });

    expect(topics).toHaveBeenCalledWith(100);
    expect(channel).toHaveBeenCalledWith("mju-chat:b4c4033b-c716-4a55-875b-ad526474ce44",{config:{private:true}});
    expect(httpSend).toHaveBeenCalledWith("message", { messageId: 7,eventId:expect.stringMatching(/^[0-9a-f-]{36}$/i) },{timeout:1500});
    expect(authorize).toHaveBeenCalledWith(100,expect.any(String),expect.any(Function));
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it("never throws when the underlying send fails -- best-effort only", async () => {
    httpSend.mockRejectedValueOnce(new Error("network error"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      broadcastChatEvent(100, { event: "reaction", payload: { messageId: 1 } }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("carries only numeric ids for a 'read' event, never message content", async () => {
    httpSend.mockResolvedValueOnce({ success: true });

    await broadcastChatEvent(100, { event: "read", payload: { userId: 5, lastReadMessageId: 42 } });

    expect(httpSend).toHaveBeenCalledWith("read", { userId: 5, lastReadMessageId: 42,eventId:expect.any(String) },{timeout:1500});
  });
  it("does not fall back to public delivery when grant lookup fails",async()=>{
    topics.mockRejectedValueOnce(new Error("database unavailable"));
    await broadcastChatEvent(100,{event:"message",payload:{messageId:1}});
    expect(channel).not.toHaveBeenCalled();
  });
  it("does not send after a grant is revoked during dispatch",async()=>{
    authorize.mockImplementationOnce(async()=>{});
    await broadcastChatEvent(100,{event:"message",payload:{messageId:1}});
    expect(httpSend).not.toHaveBeenCalled();
  });
});
