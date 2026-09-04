import { describe, expect, it } from "vitest";

import { validateNickname } from "./nickname";

describe("validateNickname", () => {
  it("accepts a valid Korean nickname", () => {
    const result = validateNickname("고양이집사");
    expect(result).toEqual({ ok: true, value: "고양이집사" });
  });

  it("accepts a valid alphanumeric nickname", () => {
    expect(validateNickname("user123")).toEqual({ ok: true, value: "user123" });
  });

  it("trims surrounding whitespace before validating/storing", () => {
    expect(validateNickname("  홍길동  ")).toEqual({ ok: true, value: "홍길동" });
  });

  it("rejects an empty string", () => {
    const result = validateNickname("");
    expect(result.ok).toBe(false);
  });

  it("rejects a nickname shorter than the minimum length", () => {
    expect(validateNickname("a").ok).toBe(false);
  });

  it("rejects a nickname longer than the maximum length", () => {
    expect(validateNickname("a".repeat(21)).ok).toBe(false);
  });

  it("rejects nicknames with disallowed characters", () => {
    expect(validateNickname("hello world").ok).toBe(false); // space
    expect(validateNickname("user!!").ok).toBe(false); // punctuation
  });
});
