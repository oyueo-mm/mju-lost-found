import { prisma } from "@/lib/db/prisma";
import { can, isActiveFullAdmin } from "@/lib/permissions/check";
import type { PermissionHolder } from "@/lib/permissions/check";
import { recordAdminActivity } from "@/lib/admin/activityLog";
import { revokeAllSessions } from "@/lib/auth/sessionRevocation";

// Security audit P-5: an administrator ends every session of a member (a
// stolen cookie, a compromised account) without suspending it -- the member
// can sign in again with Google right away. 사용자 제재 (users.sanction) is
// required; ending an administrator's sessions additionally needs a full
// administrator, so a sanction-only admin cannot keep signing other admins
// out. Reversible and non-punitive, so no two-admin proposal. Always
// recorded in 관리자 활동 (who, whom, when).
export type RevokeUserSessionsResult =
  | { kind: "ok"; revokedAt: Date }
  | { kind: "forbidden" }
  | { kind: "not_found" };

export async function revokeUserSessionsByAdmin(
  admin: PermissionHolder & { id: number },
  targetUserId: number,
): Promise<RevokeUserSessionsResult> {
  if (!can(admin, "users.sanction")) return { kind: "forbidden" };
  const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, isAdmin: true } });
  if (!target) return { kind: "not_found" };
  if (target.isAdmin && target.id !== admin.id && !isActiveFullAdmin(admin)) return { kind: "forbidden" };
  const revokedAt = await revokeAllSessions(target.id);
  await recordAdminActivity(admin.id, "user.sessions_revoke", { type: "user", id: target.id });
  return { kind: "ok", revokedAt };
}
