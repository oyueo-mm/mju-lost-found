import { describe, expect, it } from "vitest";

import { buildImagePathname, isValidImagePathname, parseImagePathname } from "./pathname";

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
