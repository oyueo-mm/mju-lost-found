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
// have to remember the redirect themselves. Route Handlers need a variant
// that returns a 401 instead of redirecting -- see src/lib/posts/http.ts's
// requireUserForApi(), which wraps getCurrentUser() the same way for that
// case, rather than overloading this function's return type.
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

// The full page-level gate used before a write action, matching the
// legacy ui/auth.py::require_ready_user(): not logged in -> /login;
// logged in but nickname not set yet -> /onboarding; both satisfied ->
// the User row. Used by /lost/new, /found/new, and the edit page.
export async function requireReadyUser(): Promise<User> {
  const user = await requireUser();
  if (user.nickname === null) redirect("/onboarding");
  return user;
}

// Page-level gate for admin-only pages, matching legacy
// ui/auth.py::require_admin(): reuses requireReadyUser()'s login/nickname
// checks, then re-verifies isAdmin against the just-fetched DB row --
// never trusts anything client-side. Every admin-only service function
// (see src/lib/moderation/service.ts's isAdmin/requireAdminForApi) also
// re-checks this itself, so this page gate is a UX convenience and first
// line of defense, never the only thing enforcing it. Redirects to /login
// or /onboarding via requireReadyUser, or to / if logged in but not an
// admin (there's no dedicated "access denied" page in this app).
export async function requireAdmin(): Promise<User> {
  const user = await requireReadyUser();
  if (!user.isAdmin) redirect("/");
  return user;
}
