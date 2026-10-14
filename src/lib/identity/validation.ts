// 실명·학과 입력 검증. The values are what the member types in -- they are
// checked for shape only, never treated as verified school records.

export const REAL_NAME_MAX_LENGTH = 40;
export const DEPARTMENT_MAX_LENGTH = 50;
export const VIEW_REASON_MIN_LENGTH = 5;
export const VIEW_REASON_MAX_LENGTH = 500;

export type IdentityFieldError = "realName.required" | "realName.invalid" | "department.required" | "department.invalid";

export type IdentityInput = { realName: string; department: string };

export type IdentityValidation =
  | { ok: true; value: IdentityInput }
  | { ok: false; errors: Partial<Record<keyof IdentityInput, IdentityFieldError>> };

const normalize = (value: string) => value.normalize("NFC").replace(/\s+/g, " ").trim();

// Letters of any script (Korean, Latin, Mongolian, Vietnamese, CJK, ...)
// with the spaces, dots, hyphens and apostrophes names use. No digits.
const REAL_NAME = /^[\p{L}\p{M}][\p{L}\p{M} .'·-]*$/u;
// 학과 or 소속 (e.g. "컴퓨터공학과", "학생지원팀", "Dept. of Business (MBA)").
const DEPARTMENT = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .'·&()/,-]*$/u;

export function validateIdentityInput(raw: { realName: unknown; department: unknown }): IdentityValidation {
  const realName = normalize(typeof raw.realName === "string" ? raw.realName : "");
  const department = normalize(typeof raw.department === "string" ? raw.department : "");
  const errors: Partial<Record<keyof IdentityInput, IdentityFieldError>> = {};

  if (realName === "") errors.realName = "realName.required";
  else if ([...realName].length < 2 || [...realName].length > REAL_NAME_MAX_LENGTH || !REAL_NAME.test(realName)) {
    errors.realName = "realName.invalid";
  }
  if (department === "") errors.department = "department.required";
  else if ([...department].length < 2 || [...department].length > DEPARTMENT_MAX_LENGTH || !DEPARTMENT.test(department)) {
    errors.department = "department.invalid";
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: { realName, department } };
}

// An admin's reason for viewing a member's 실명·학과 (stored in the log).
export function normalizeViewReason(raw: unknown): string | null {
  const reason = normalize(typeof raw === "string" ? raw : "");
  const length = [...reason].length;
  return length >= VIEW_REASON_MIN_LENGTH && length <= VIEW_REASON_MAX_LENGTH ? reason : null;
}
