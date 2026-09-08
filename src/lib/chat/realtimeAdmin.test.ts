import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const httpSend = vi.fn();
const channel = vi.fn(() => ({ httpSend }));
const createClient = vi.fn(() => ({ channel }));

vi.mock("@supabase/supabase-js", () => ({ createClient }));

const { broadcastChatEvent } = await import("./realtimeAdmin");

const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIGINAL_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
});

afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_KEY;
});

describe("broadcastChatEvent", () => {
  it("sends to a channel named after the chat room, with the event/payload as given", async () => {
    httpSend.mockResolvedValueOnce({ success: true });

    await broadcastChatEvent(100, { event: "message", payload: { messageId: 7 } });

    expect(channel).toHaveBeenCalledWith("chat-room-100");
    expect(httpSend).toHaveBeenCalledWith("message", { messageId: 7 });
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

    expect(httpSend).toHaveBeenCalledWith("read", { userId: 5, lastReadMessageId: 42 });
  });
});
