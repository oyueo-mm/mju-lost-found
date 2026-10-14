import { describe, expect, it } from "vitest";

import { normalizeViewReason, validateIdentityInput } from "./validation";

describe("validateIdentityInput", () => {
  it("accepts names in any script and trims/collapses spaces", () => {
    for (const realName of ["홍길동", "Nguyễn Văn An", "Батбаяр", "李小龙", "Anne-Marie O'Neil", "Kim J. Ho"]) {
      expect(validateIdentityInput({ realName, department: "컴퓨터공학과" }).ok).toBe(true);
    }
    expect(validateIdentityInput({ realName: "  홍   길동 ", department: " 학생지원팀 " })).toEqual({
      ok: true,
      value: { realName: "홍 길동", department: "학생지원팀" },
    });
  });

  it("rejects empty, one-letter, numeric or symbol names", () => {
    expect(validateIdentityInput({ realName: "", department: "학과" })).toMatchObject({ ok: false, errors: { realName: "realName.required" } });
    for (const realName of ["홍", "홍길동1", "<script>", "a".repeat(41)]) {
      expect(validateIdentityInput({ realName, department: "학과" })).toMatchObject({ ok: false, errors: { realName: "realName.invalid" } });
    }
  });

  it("accepts departments and offices with digits and punctuation, rejects junk", () => {
    for (const department of ["컴퓨터공학과", "Dept. of Business (MBA)", "학생지원팀", "AI·SW 융합대학"]) {
      expect(validateIdentityInput({ realName: "홍길동", department }).ok).toBe(true);
    }
    expect(validateIdentityInput({ realName: "홍길동", department: "" })).toMatchObject({ errors: { department: "department.required" } });
    for (const department of ["x", "@@학과", "가".repeat(51)]) {
      expect(validateIdentityInput({ realName: "홍길동", department })).toMatchObject({ errors: { department: "department.invalid" } });
    }
  });

  it("treats non-string input as empty", () => {
    expect(validateIdentityInput({ realName: null, department: 3 })).toMatchObject({
      ok: false,
      errors: { realName: "realName.required", department: "department.required" },
    });
  });
});

describe("normalizeViewReason", () => {
  it("needs 5 to 500 characters after trimming", () => {
    expect(normalizeViewReason("  반환 분쟁 확인 ")).toBe("반환 분쟁 확인");
    expect(normalizeViewReason("확인")).toBeNull();
    expect(normalizeViewReason("가".repeat(501))).toBeNull();
    expect(normalizeViewReason(undefined)).toBeNull();
  });
});
