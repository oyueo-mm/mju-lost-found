import { validateIdentityInput } from "./validation";

// 실명·학과 자동 입력 (Google). What Google sign-in can suggest for the
// 실명·학과 form -- suggestions only:
//
// - name: the Google account's display name (OpenID `name` claim, scope
//   "profile"). The account holder can usually change it, so it is never
//   treated as a school-verified real name -- the member confirms or edits
//   it on the form.
// - department: only with the People API `organizations` field, which needs
//   the sensitive scope user.organization.read and is filled only if the
//   school (or the member) put it on the Google profile. Off unless
//   GOOGLE_ORG_SCOPE_ENABLED=true; not verified with a real MJU account.
//   Admin-only directory APIs are never used.
//
// Hints live only in the encrypted session cookie (JWT) until the member
// saves the form with the 실명·학과 consent; nothing here writes to the DB.
// Values are never logged.

export type IdentityHints = { name: string | null; department: string | null };

export const GOOGLE_ORG_SCOPE = "https://www.googleapis.com/auth/user.organization.read";

export function isOrgScopeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.GOOGLE_ORG_SCOPE_ENABLED === "true";
}

export function googleScopes(env: Record<string, string | undefined> = process.env): string {
  return ["openid", "email", "profile", ...(isOrgScopeEnabled(env) ? [GOOGLE_ORG_SCOPE] : [])].join(" ");
}

// A usable name suggestion, or null (then the member types it in).
export function nameHintFromProfile(profile: unknown): string | null {
  const raw = (profile as { name?: unknown } | null | undefined)?.name;
  if (typeof raw !== "string") return null;
  const checked = validateIdentityInput({ realName: raw, department: "확인용" });
  return checked.ok ? checked.value.realName : null;
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
export type IdentityValueSource = "self" | "google_profile" | "google_people";

export function sourceOf(saved: string, hint: string | null | undefined, ifFromHint: IdentityValueSource): IdentityValueSource {
  return hint && saved === hint ? ifFromHint : "self";
}
