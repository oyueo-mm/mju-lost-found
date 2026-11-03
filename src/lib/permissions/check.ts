import { SUPER_ONLY_PERMISSION, isGrantablePermissionKey, type GrantablePermissionKey, type PermissionKey } from "./definitions";

// What the server knows about a signed-in user. `adminPermissions` is loaded
// from the DB on every request (session.ts::getCurrentUser) -- never taken from
// the JWT or the client -- so a revoked permission stops working at once.
export type PermissionHolder = { isAdmin?: boolean | null; adminPermissions?: readonly string[] | null };

// A full administrator (User.isAdmin) holds every permission. Anyone else holds
// exactly what was granted, and never the super-only one.
export function can(user: PermissionHolder | null | undefined, permission: PermissionKey): boolean {
  if (!user) return false;
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
  return Boolean(user.isAdmin) || (user.adminPermissions ?? []).some(isGrantablePermissionKey);
}
export function grantedKeys(user: PermissionHolder): GrantablePermissionKey[] {
  return (user.adminPermissions ?? []).filter(isGrantablePermissionKey);
}
