import { describe, expect, it } from "vitest";

import {
  buildChatImagePathname,
  buildImagePathname,
  isValidImagePathname,
  parseChatImagePathname,
  parseImagePathname,
} from "./pathname";

describe("buildImagePathname / isValidImagePathname", () => {
  it("builds a pathname that passes its own validator", () => {
    const pathname = buildImagePathname("lost", 42, "image/jpeg");
    expect(isValidImagePathname(pathname)).toBe(true);
    expect(pathname).toMatch(/^posts\/lost\/42\/[0-9a-f-]{36}\.jpg$/);
  });

  it("round-trips through parseImagePathname", () => {
    const pathname = buildImagePathname("found", 7, "image/png");
    expect(parseImagePathname(pathname)).toEqual({ postType: "found", postId: 7 });
  });

  it("rejects a path-traversal attempt", () => {
    expect(isValidImagePathname("posts/lost/../../etc/passwd")).toBe(false);
  });

  it("rejects a non-numeric postId segment", () => {
    expect(isValidImagePathname("posts/lost/not-a-number/" + "a".repeat(36) + ".jpg")).toBe(false);
  });

  it("rejects an unsupported extension", () => {
    expect(
      isValidImagePathname("posts/lost/1/11111111-1111-1111-1111-111111111111.exe"),
    ).toBe(false);
  });

  it("rejects a type outside lost/found", () => {
    expect(
      isValidImagePathname("posts/banana/1/11111111-1111-1111-1111-111111111111.jpg"),
    ).toBe(false);
  });

  it("rejects an arbitrary user-supplied filename instead of the expected shape", () => {
    expect(isValidImagePathname("my-original-filename.jpg")).toBe(false);
  });
});

// Phase 28-3: same shape/pattern as buildImagePathname/parseImagePathname
// above, just for chat/{chatRoomId}/{uuid}.{ext} instead of
// posts/{postType}/{postId}/{uuid}.{ext}.
describe("buildChatImagePathname / parseChatImagePathname", () => {
  it("builds a pathname that round-trips through parseChatImagePathname", () => {
    const pathname = buildChatImagePathname(42, "image/jpeg");
    expect(pathname).toMatch(/^chat\/42\/[0-9a-f-]{36}\.jpg$/);
    expect(parseChatImagePathname(pathname)).toEqual({ chatRoomId: 42 });
  });

  it("rejects a post pathname (wrong prefix)", () => {
    expect(parseChatImagePathname("posts/lost/1/11111111-1111-1111-1111-111111111111.jpg")).toBeNull();
  });

  it("rejects a chat pathname naming a different chat room than expected (caller's own re-check)", () => {
    const pathname = buildChatImagePathname(1, "image/png");
    const parsed = parseChatImagePathname(pathname);
    expect(parsed?.chatRoomId).not.toBe(2);
  });

  it("rejects a non-numeric chatRoomId segment", () => {
    expect(parseChatImagePathname("chat/not-a-number/" + "a".repeat(36) + ".jpg")).toBeNull();
  });

  it("rejects a path-traversal attempt", () => {
    expect(parseChatImagePathname("chat/../../etc/passwd")).toBeNull();
  });
});
