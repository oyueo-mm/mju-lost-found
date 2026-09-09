import { describe, expect, it } from "vitest";

import { formatPartialUploadFailureMessage, resolveFinalImageIds, selectNewImages } from "./galleryState";

function makeFile(name: string, type = "image/jpeg", size = 1024): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("selectNewImages", () => {
  it("accepts every valid file when there's room for all of them", () => {
    const files = [makeFile("a.jpg"), makeFile("b.png", "image/png")];
    const result = selectNewImages(files, 0, 5);
    expect(result).toEqual({ accepted: files, rejectedForCount: 0, validationError: null });
  });

  it("rejects files beyond the remaining slots (5 - current)", () => {
    const files = [makeFile("a.jpg"), makeFile("b.jpg"), makeFile("c.jpg")];
    // 4 existing + 3 new = 7, only 1 slot remains
    const result = selectNewImages(files, 4, 5);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejectedForCount).toBe(2);
  });

  it("rejects everything when the gallery is already at the max", () => {
    const result = selectNewImages([makeFile("a.jpg")], 5, 5);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejectedForCount).toBe(1);
  });

  it("rejects an unsupported file type with a validation message, not a count rejection", () => {
    const result = selectNewImages([makeFile("a.gif", "image/gif")], 0, 5);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejectedForCount).toBe(0);
    expect(result.validationError).toBe("JPEG, PNG, WebP 형식만 업로드할 수 있습니다.");
  });

  it("rejects an oversized file with a validation message", () => {
    const result = selectNewImages([makeFile("a.jpg", "image/jpeg", 11 * 1024 * 1024)], 0, 5);
    expect(result.accepted).toHaveLength(0);
    expect(result.validationError).toBe("파일 크기는 10MB를 넘을 수 없습니다.");
  });

  it("still accepts the valid files in a mixed batch alongside a validation failure", () => {
    const valid = makeFile("good.jpg");
    const result = selectNewImages([valid, makeFile("bad.gif", "image/gif")], 0, 5);
    expect(result.accepted).toEqual([valid]);
    expect(result.validationError).toBe("JPEG, PNG, WebP 형식만 업로드할 수 있습니다.");
  });
});

describe("formatPartialUploadFailureMessage", () => {
  it("returns null when nothing failed", () => {
    expect(formatPartialUploadFailureMessage(5, 0)).toBeNull();
  });

  it("formats a partial-failure summary", () => {
    expect(formatPartialUploadFailureMessage(5, 2)).toBe("5장 중 3장 업로드 완료. 2장은 업로드하지 못했습니다.");
  });

  it("formats a total-failure summary", () => {
    expect(formatPartialUploadFailureMessage(3, 3)).toBe("3장 중 0장 업로드 완료. 3장은 업로드하지 못했습니다.");
  });
});

describe("resolveFinalImageIds", () => {
  it("returns existing ids in order when there are no new items", () => {
    const items = [
      { kind: "existing" as const, id: 10, url: "https://a" },
      { kind: "existing" as const, id: 11, url: "https://b" },
    ];
    expect(resolveFinalImageIds(items, new Map())).toEqual([10, 11]);
  });

  it("resolves new items to their attached real id, preserving overall order", () => {
    const items = [
      { kind: "existing" as const, id: 10, url: "https://a" },
      { kind: "new" as const, localId: "n1", file: makeFile("a.jpg"), previewUrl: "blob:a" },
      { kind: "existing" as const, id: 11, url: "https://b" },
    ];
    const attached = new Map([["n1", { id: 99 }]]);
    expect(resolveFinalImageIds(items, attached)).toEqual([10, 99, 11]);
  });

  it("drops a new item that never got attached (upload failed)", () => {
    const items = [
      { kind: "existing" as const, id: 10, url: "https://a" },
      { kind: "new" as const, localId: "n1", file: makeFile("a.jpg"), previewUrl: "blob:a" },
    ];
    expect(resolveFinalImageIds(items, new Map())).toEqual([10]);
  });
});
