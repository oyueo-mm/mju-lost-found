import { prisma } from "@/lib/db/prisma";

// Get-or-create by email (already @unique on User), matching the legacy
// ui/auth.py::resolve_user_id() pattern -- this, not googleId, is what
// actually prevents a duplicate User for the same Google account. googleId
// is recorded/refreshed alongside it as the more stable identifier (see
// the User.googleId comment in schema.prisma).
export async function resolveOrCreateUser(params: {
  email: string;
  name: string | null;
  googleId: string;
}) {
  // Phase P-1: this upsert only ever runs from the jwt callback's
  // `account`-present branch -- i.e. a real Google sign-in exchange, never
  // a plain JWT-cookie refresh on a later request -- so `now()` here is a
  // true "last login" timestamp, not merely "session still valid" (see
  // User.lastLoginAt's own schema comment).
  return prisma.user.upsert({
    where: { email: params.email },
    update: {
      googleId: params.googleId,
      name: params.name ?? undefined,
      lastLoginAt: new Date(),
    },
    create: {
      email: params.email,
      name: params.name ?? params.email.split("@")[0],
      googleId: params.googleId,
      lastLoginAt: new Date(),
    },
  });
}

// Phase 8: the only place privacyConsentAt is ever written -- called
// solely from POST /api/me/privacy-consent, i.e. only when the user
// themselves clicked the consent button (never from the OAuth/login flow
// above, see that column's own schema.prisma comment). `new Date()` is
// this server's own clock, never a client-supplied value, matching this
// phase's own "클라이언트가 전달한 timestamp를 신뢰하지 않는다" requirement.
//
// The `privacyConsentAt: null` guard in the where-clause makes this
// idempotent without clobbering an already-recorded consent instant: a
// second call (double-submit, or hitting the API directly after already
// consenting) matches zero rows and changes nothing, so the *original*
// consent timestamp is what's preserved -- mirrors
// onboarding/actions.ts's identical "only if still unset" pattern for
// nickname.
export async function recordPrivacyConsent(userId: number) {
  await prisma.user.updateMany({
    where: { id: userId, privacyConsentAt: null },
    data: { privacyConsentAt: new Date() },
  });
  return prisma.user.findUniqueOrThrow({ where: { id: userId } });
}
