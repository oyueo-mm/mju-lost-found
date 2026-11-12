import { SUPER_ONLY_PERMISSION, isGrantablePermissionKey, type GrantablePermissionKey, type PermissionKey } from "./definitions";

// What the server knows about a signed-in user. `adminPermissions` is loaded
// from the DB on every request (session.ts::getCurrentUser) -- never taken from
// the JWT or the client -- so a revoked permission stops working at once.
//
// The suspension state is required, not optional: a holder built without it
// could not be checked for suspension, so such a call site fails to compile
// instead of silently treating the account as active.
export type PermissionHolder = {
  isAdmin?: boolean | null;
  adminPermissions?: readonly string[] | null;
  isSuspended: boolean | null;
  suspendedUntil: Date | null;
};

// Same rule as auth/suspension.ts::isCurrentlySuspended (kept here so this
// module stays free of imports a client bundle would not want).
export function isSuspendedHolder(user: Pick<PermissionHolder, "isSuspended" | "suspendedUntil">, now: number = Date.now()): boolean {
  if (!user.isSuspended) return false;
  if (user.suspendedUntil === null) return true;
  return user.suspendedUntil.getTime() > now;
}

// A full administrator whose account is not currently suspended. Every
// "full admin only" authorization (requireAdmin, the proposal flow, ...)
// goes through this instead of reading User.isAdmin directly.
export function isActiveFullAdmin(user: Pick<PermissionHolder, "isAdmin" | "isSuspended" | "suspendedUntil"> | null | undefined): boolean {
  if (!user) return false;
  return Boolean(user.isAdmin) && !isSuspendedHolder(user);
}

// A full administrator (User.isAdmin) holds every permission. Anyone else holds
// exactly what was granted, and never the super-only one. A suspended account
// holds none: suspension stops administrative access too, and a suspended
// administrator can therefore not lift its own suspension.
export function can(user: PermissionHolder | null | undefined, permission: PermissionKey): boolean {
  if (!user) return false;
  if (isSuspendedHolder(user)) return false;
  if (user.isAdmin) return true;
  if (permission === SUPER_ONLY_PERMISSION) return false;
  return Boolean(user.adminPermissions?.includes(permission));
}
export function canAny(user: PermissionHolder | null | undefined, permissions: readonly PermissionKey[]): boolean {
  return permissions.some((p) => can(user, p));
}
// Any admin capability at all (shows the 관리자 menu).
export function hasAnyAdminPermission(user: PermissionHolder | null | undefined): boolean {
  if (!user) return false;
  if (isSuspendedHolder(user)) return false;
  return Boolean(user.isAdmin) || (user.adminPermissions ?? []).some(isGrantablePermissionKey);
}
// The stored grants (for display, e.g. on the user detail page) -- not an
// authorization check; use can() for that.
export function grantedKeys(user: Pick<PermissionHolder, "adminPermissions">): GrantablePermissionKey[] {
  return (user.adminPermissions ?? []).filter(isGrantablePermissionKey);
}
