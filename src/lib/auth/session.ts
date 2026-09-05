import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/auth";
import { isCurrentlySuspended } from "@/lib/auth/suspension";
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

// Phase 14: which one-line explanation /login shows above the Google
// button when a protected page bounces a logged-out visitor there --
// purely a UX label, never itself a permission (every actual check still
// happens below and, redundantly, in the API layer -- see
// requireUserForApi()). Kept as a closed set rather than a free-form
// string so a typo'd reason at a call site is a compile error, not a
// silently-blank message on /login.
export type LoginReason = "write" | "chat" | "match" | "mypost" | "notification";

// Only ever built from this module's own string literals (the `reason`
// union above) and each call site's own hardcoded path -- never from
// unsanitized user input -- so no sanitization is needed on the way out.
// sanitizeCallbackUrl() below is what guards the *return* trip (reading
// this same param back out of the URL on /login), which is the side that
// actually matters for open-redirect safety.
function loginRedirectUrl(reason?: LoginReason, callbackUrl?: string): string {
  const params = new URLSearchParams();
  if (reason) params.set("reason", reason);
  if (callbackUrl) params.set("callbackUrl", callbackUrl);
  const query = params.toString();
  return query ? `/login?${query}` : "/login";
}

// /login reads a caller-supplied `callbackUrl` back out of its own query
// string (see loginRedirectUrl above, and DirectChatButton's login-prompt
// link on /post/[id]) to send the user back where they came from after
// signing in. That value crosses a client-visible URL, so it's untrusted
// regardless of who normally sets it -- only a same-origin relative path
// is accepted (must start with exactly one "/", never "//..." which a
// browser resolves as protocol-relative to an *external* host, and never
// contain "://"), so this can never become an open redirect to another
// site. Returns undefined for anything else, which callers treat as "no
// callback url" rather than an error.
export function sanitizeCallbackUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  if (!url.startsWith("/") || url.startsWith("//") || url.includes("://")) return undefined;
  return url;
}

// For Server Components/Server Actions that require a signed-in user --
// redirects to /login instead of returning null so callers don't each
// have to remember the redirect themselves. Route Handlers need a variant
// that returns a 401 instead of redirecting -- see src/lib/posts/http.ts's
// requireUserForApi(), which wraps getCurrentUser() the same way for that
// case, rather than overloading this function's return type.
//
// `reason`/`callbackUrl` (Phase 14) are UX-only: they decide what /login
// says and where it sends the user back to after signing in. Omitting
// them still redirects to a plain /login exactly as before -- every
// existing call site that doesn't pass them keeps working unchanged.
export async function requireUser(reason?: LoginReason, callbackUrl?: string): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect(loginRedirectUrl(reason, callbackUrl));
  return user;
}

// The full page-level gate used before a write action, matching the
// legacy ui/auth.py::require_ready_user(): not logged in -> /login;
// logged in but nickname not set yet -> /onboarding; both satisfied ->
// the User row. Used by /lost/new, /found/new, and the edit page.
export async function requireReadyUser(reason?: LoginReason, callbackUrl?: string): Promise<User> {
  const user = await requireUser(reason, callbackUrl);
  if (user.nickname === null) redirect("/onboarding");
  return user;
}

// Central gate for a future Server Action/page that wants "logged in,
// nickname set, AND not currently suspended" in one call, instead of
// repeating requireReadyUser() + isCurrentlySuspended() at every call site.
// This does NOT replace the existing per-mutation checks in
// posts/match/chat's service functions (createLostPost, createMatch,
// sendMessage, ...) -- those intentionally return a typed "forbidden"
// result so their callers (API routes) can respond with a 403 JSON error
// the same way the legacy app's PermissionDeniedError does, which a
// redirect-based gate can't express for a fetch() caller. Use this only
// for a Server Component/Server Action that should never even render for a
// suspended user; redirects to /suspended (which itself re-checks and
// bounces home if the suspension has since expired).
export async function requireActiveUser(): Promise<User> {
  const user = await requireReadyUser();
  if (isCurrentlySuspended(user)) redirect("/suspended");
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
