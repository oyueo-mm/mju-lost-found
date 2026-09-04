import { describe, expect, it } from "vitest";

import { isAllowedEmail } from "./domain";

describe("isAllowedEmail", () => {
  it("allows an @mju.ac.kr address", () => {
    expect(isAllowedEmail("student@mju.ac.kr")).toBe(true);
  });

  it("rejects a non-mju address", () => {
    expect(isAllowedEmail("someone@gmail.com")).toBe(false);
  });

  it("is case-insensitive on the domain", () => {
    expect(isAllowedEmail("Student@MJU.AC.KR")).toBe(true);
  });

  it("rejects a lookalike domain that merely contains mju.ac.kr", () => {
    expect(isAllowedEmail("student@mju.ac.kr.evil.com")).toBe(false);
  });

  it("rejects null/undefined/empty", () => {
    expect(isAllowedEmail(null)).toBe(false);
    expect(isAllowedEmail(undefined)).toBe(false);
    expect(isAllowedEmail("")).toBe(false);
  });
});
