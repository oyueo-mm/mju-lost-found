import { validateIdentityInput } from "./validation";

// 실명·학과 자동 입력 (Google). What Google sign-in can suggest for the
// 실명·학과 form -- suggestions only:
//
// - name: the Google account's display name (OpenID `name` claim, scope
//   "profile"). The account holder can usually change it, so it is never
//   treated as a school-verified real name -- the member confirms or edits
//   it on the form.
// - "이름/신분/소속" display names (parseGoogleDisplayName): the name and
//   affiliation parts, when the Google name has exactly that form.
// - department: also from the People API `organizations` field, which needs
//   the sensitive scope user.organization.read and is filled only if the
//   school (or the member) put it on the Google profile. Off unless
//   GOOGLE_ORG_SCOPE_ENABLED=true; not verified with a real MJU account.
//   Admin-only directory APIs are never used.
//
// Hints live only in the encrypted session cookie (JWT) until the member
// saves the form with the 실명·학과 consent; nothing here writes to the DB.
// Values are never logged.

// Where a hint came from (kept with it so the saved value's source is exact).
export type IdentityHintSource = "google_profile" | "google_display_name" | "google_people";

export type IdentityHints = {
  name: string | null;
  department: string | null;
  nameSource?: IdentityHintSource;
  departmentSource?: IdentityHintSource;
};

export const GOOGLE_ORG_SCOPE = "https://www.googleapis.com/auth/user.organization.read";

export function isOrgScopeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.GOOGLE_ORG_SCOPE_ENABLED === "true";
}

export function googleScopes(env: Record<string, string | undefined> = process.env): string {
  return ["openid", "email", "profile", ...(isOrgScopeEnabled(env) ? [GOOGLE_ORG_SCOPE] : [])].join(" ");
}

// 표시 이름 "이름/신분/소속" (format used by the earlier MJU Find, which
// read it from the same Google name; not yet confirmed on a real MJU
// account). Only an exact match is split: three non-empty parts, the
// middle one a known role word, and name and affiliation each passing
// their own checks. The role is only used to recognise the format -- it
// is never returned or stored. The affiliation may be a college rather
// than a department; it is a suggestion like the rest.
export const MEMBER_TYPE_WORDS = ["학생", "교수", "직원", "조교", "연구원"] as const;

export type ParsedDisplayName = { name: string; affiliation: string };

export function parseGoogleDisplayName(raw: unknown): ParsedDisplayName | null {
  if (typeof raw !== "string") return null;
  const parts = raw.normalize("NFC").split("/").map((part) => part.trim());
  if (parts.length !== 3 || parts.some((part) => part === "")) return null;
  const [name, memberType, affiliation] = parts;
  if (!(MEMBER_TYPE_WORDS as readonly string[]).includes(memberType)) return null;
  const checked = validateIdentityInput({ realName: name, department: affiliation });
  return checked.ok ? { name: checked.value.realName, affiliation: checked.value.department } : null;
}

// Suggestions from the Google name: split when it has the "이름/신분/소속"
// form; otherwise the whole name, if it is a plausible name by itself (a
// name with any "/" never is, so a malformed structured name gives no
// suggestion rather than a wrong one).
export function hintsFromProfile(profile: unknown): IdentityHints {
  const raw = (profile as { name?: unknown } | null | undefined)?.name;
  const parsed = parseGoogleDisplayName(raw);
  if (parsed) {
    return { name: parsed.name, department: parsed.affiliation, nameSource: "google_display_name", departmentSource: "google_display_name" };
  }
  if (typeof raw !== "string") return { name: null, department: null };
  const checked = validateIdentityInput({ realName: raw, department: "확인용" });
  return checked.ok ? { name: checked.value.realName, department: null, nameSource: "google_profile" } : { name: null, department: null };
}

// A usable name suggestion, or null (then the member types it in).
export function nameHintFromProfile(profile: unknown): string | null {
  return hintsFromProfile(profile).name;
}

type PeopleOrganization = { department?: unknown; metadata?: { primary?: unknown } };

// The member's own department from their Google profile, if any. Any
// failure (scope not granted, field empty, network) is just "no hint".
export async function fetchDepartmentHint(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl("https://people.googleapis.com/v1/people/me?personFields=organizations", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { organizations?: PeopleOrganization[] };
    const organizations = (body.organizations ?? []).filter((o) => typeof o.department === "string");
    const chosen = organizations.find((o) => o.metadata?.primary === true) ?? organizations[0];
    if (!chosen) return null;
    const checked = validateIdentityInput({ realName: "확인용", department: chosen.department });
    return checked.ok ? checked.value.department : null;
  } catch {
    return null;
  }
}

// Where a saved value came from: the suggestion as-is, or typed/edited by
// the member. Either way it is the member's own confirmation, not a
// verified record.
export type IdentityValueSource = "self" | IdentityHintSource;

export function sourceOf(saved: string, hint: string | null | undefined, ifFromHint: IdentityValueSource): IdentityValueSource {
  return hint && saved === hint ? ifFromHint : "self";
}
