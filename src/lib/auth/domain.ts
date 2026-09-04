// Pure, unit-testable logic -- no next-auth/Prisma import here, mirrors the
// legacy Streamlit project's ui/auth.py::is_allowed_domain(). Only this
// function decides who is allowed in; it must run server-side (the
// next-auth `signIn` callback), never only in the browser.

const ALLOWED_EMAIL_DOMAIN = "@mju.ac.kr";

export function isAllowedEmail(email: string | null | undefined): boolean {
  return Boolean(email) && email!.toLowerCase().endsWith(ALLOWED_EMAIL_DOMAIN);
}
