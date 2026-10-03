import { beforeEach, describe, expect, it, vi } from "vitest";

const storageBucket = {
  createSignedUploadUrl: vi.fn(),
  createSignedUrl: vi.fn(),
  exists: vi.fn(),
  remove: vi.fn(),
};
const from = vi.fn((bucket: string) => (void bucket, storageBucket));
vi.mock("@/lib/supabase/adminClient", () => ({ getSupabaseAdminClient: () => ({ storage: { from } }) }));

const { chatImageExists, createChatImageSignedUrl, createChatImageUploadUrl, deleteChatImageSafely } = await import(
  "./chatStorage"
);

const PATH = "chat/12/0f8fad5b-d9cb-469f-a165-70867728950e.webp";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("chatStorage (private chat-images bucket)", () => {
  it("always uses the chat-images bucket, never post-images", async () => {
    storageBucket.createSignedUploadUrl.mockResolvedValueOnce({ data: { path: PATH, token: "t" }, error: null });
    storageBucket.createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: "https://s/sign" }, error: null });
    storageBucket.exists.mockResolvedValueOnce({ data: true, error: null });
    storageBucket.remove.mockResolvedValueOnce({ data: [], error: null });

    await createChatImageUploadUrl(PATH);
    await createChatImageSignedUrl(PATH);
    await chatImageExists(PATH);
    await deleteChatImageSafely(PATH);

    expect(from.mock.calls.every(([bucket]) => bucket === "chat-images")).toBe(true);
    expect(from).toHaveBeenCalledTimes(4);
  });

  it("signs URLs for 60 seconds", async () => {
    storageBucket.createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: "https://s/sign" }, error: null });

    expect(await createChatImageSignedUrl(PATH)).toBe("https://s/sign");
    expect(storageBucket.createSignedUrl).toHaveBeenCalledWith(PATH, 60);
  });

  it("deletes exactly the one path it is given", async () => {
    storageBucket.remove.mockResolvedValueOnce({ data: [], error: null });

    await deleteChatImageSafely(PATH);

    expect(storageBucket.remove).toHaveBeenCalledWith([PATH]);
  });

  it("refuses to delete anything that isn't a chat image path", async () => {
    await deleteChatImageSafely("posts/lost/1/0f8fad5b-d9cb-469f-a165-70867728950e.webp");
    await deleteChatImageSafely("chat/12");
    await deleteChatImageSafely("");

    expect(storageBucket.remove).not.toHaveBeenCalled();
  });

  it("never rejects when Storage fails (the DB change already committed)", async () => {
    storageBucket.remove.mockResolvedValueOnce({ data: null, error: new Error("boom") });

    await expect(deleteChatImageSafely(PATH)).resolves.toBeUndefined();
  });

  it("reports a missing object as not existing", async () => {
    storageBucket.exists.mockResolvedValueOnce({ data: false, error: null });
    expect(await chatImageExists(PATH)).toBe(false);
    storageBucket.exists.mockResolvedValueOnce({ data: false, error: new Error("not found") });
    expect(await chatImageExists(PATH)).toBe(false);
  });
});
