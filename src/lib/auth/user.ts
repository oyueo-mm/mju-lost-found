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
