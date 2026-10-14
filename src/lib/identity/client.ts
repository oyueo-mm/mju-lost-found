// Shared by the server gate (posts/http.ts::requireIdentityForApi) and the
// client buttons that react to it -- no server-only imports here.
export const IDENTITY_REQUIRED_CODE = "identity_required";

export function isIdentityRequired(json: unknown): boolean {
  return (json as { code?: unknown } | null)?.code === IDENTITY_REQUIRED_CODE;
}

// The 실명·학과 form, coming back to `returnTo` (a same-site path) after saving.
export function identityFormHref(returnTo: string): string {
  return `/me/identity?callbackUrl=${encodeURIComponent(returnTo)}`;
}
