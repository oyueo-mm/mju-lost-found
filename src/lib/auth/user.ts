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
  return prisma.user.upsert({
    where: { email: params.email },
    update: {
      googleId: params.googleId,
      name: params.name ?? undefined,
    },
    create: {
      email: params.email,
      name: params.name ?? params.email.split("@")[0],
      googleId: params.googleId,
    },
  });
}
