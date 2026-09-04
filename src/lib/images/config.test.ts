import { describe, expect, it } from "vitest";

import { isAllowedImageContentType, MAX_IMAGE_SIZE_BYTES } from "./config";
import { validateImageFile } from "./client";

function makeFile(type: string, size: number): File {
  return new File([new Uint8Array(size)], "test", { type });
}

describe("isAllowedImageContentType", () => {
  it("allows jpeg, png, webp", () => {
    expect(isAllowedImageContentType("image/jpeg")).toBe(true);
    expect(isAllowedImageContentType("image/png")).toBe(true);
    expect(isAllowedImageContentType("image/webp")).toBe(true);
  });

  it("rejects an unsupported MIME type such as gif", () => {
    expect(isAllowedImageContentType("image/gif")).toBe(false);
  });

  it("rejects a non-image MIME type entirely", () => {
    expect(isAllowedImageContentType("application/octet-stream")).toBe(false);
  });
});

describe("validateImageFile", () => {
  it("accepts a valid small JPEG", () => {
    expect(validateImageFile(makeFile("image/jpeg", 1024))).toBeNull();
  });

  it("accepts a valid PNG", () => {
    expect(validateImageFile(makeFile("image/png", 1024))).toBeNull();
  });

  it("accepts a valid WebP", () => {
    expect(validateImageFile(makeFile("image/webp", 1024))).toBeNull();
  });

  it("rejects an unsupported type", () => {
    expect(validateImageFile(makeFile("image/gif", 1024))?.code).toBe("type");
  });

  it("rejects a file over the 10MB limit", () => {
    expect(validateImageFile(makeFile("image/jpeg", MAX_IMAGE_SIZE_BYTES + 1))?.code).toBe("size");
  });

  it("accepts a file exactly at the limit", () => {
    expect(validateImageFile(makeFile("image/jpeg", MAX_IMAGE_SIZE_BYTES))).toBeNull();
  });
});
