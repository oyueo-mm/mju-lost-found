import type { User } from "@/generated/prisma/client";

// Mirrors the legacy ui/auth.py::is_user_suspended()/db.is_user_suspended():
// permanent if suspendedUntil is null, otherwise active only until it
// expires. An expired timed suspension reads as "not suspended" without
// writing back to the row -- the suspension record stays for audit
// purposes, this is a read-time computation only.
export function isCurrentlySuspended(user: Pick<User, "isSuspended" | "suspendedUntil">): boolean {
  if (!user.isSuspended) return false;
  if (user.suspendedUntil === null) return true;
  return user.suspendedUntil.getTime() > Date.now();
}
