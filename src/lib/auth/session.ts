import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import type { User } from "@/generated/prisma/client";

// Always re-reads the User row from the DB instead of trusting the JWT's
// cached id/nickname for anything beyond routing -- same rule the legacy
// ui/auth.py::current_user() follows (is_admin/is_suspended must never be
// read from client-controlled state). Returns null for both "not logged
// in" and "session points at a User that no longer exists".
export async function getCurrentUser(): Promise<User | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  return prisma.user.findUnique({ where: { id: Number(userId) } });
}

// For Server Components/Server Actions that require a signed-in user --
// redirects to /login instead of returning null so callers don't each
// have to remember the redirect themselves. Route Handlers (Phase 3) will
// need a variant that returns a 401 instead of redirecting; add that
// alongside this one when that's needed, rather than overloading this
// function's return type now.
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
