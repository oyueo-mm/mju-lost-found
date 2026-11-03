import { prisma } from "@/lib/db/prisma";
import { GRANTABLE_PERMISSION_KEYS, PERMISSION_PRESETS, matchingPresetId, type GrantablePermissionKey } from "./definitions";

export type PermissionState = {
  permissions: GrantablePermissionKey[];
  organizationId: number | null;
  organizationName: string | null;
  facility: string;
  // The last time this account's permissions were changed (audit trail).
  changedAt: Date | null;
};

// Read-only view of several accounts' permissions, for the user management pages.
export async function loadPermissionStates(userIds: number[]): Promise<Map<number, PermissionState>> {
  const states = new Map<number, PermissionState>();
  if (!userIds.length) return states;
  const [grants, officers, changes] = await Promise.all([
    prisma.adminPermissionGrant.findMany({ where: { userId: { in: userIds } }, select: { userId: true, permission: true } }),
    prisma.institutionOfficer.findMany({ where: { userId: { in: userIds } }, select: { userId: true, active: true, organizationId: true, facility: true, organization: { select: { name: true } } } }),
    prisma.institutionOfficerAudit.groupBy({ by: ["targetUserId"], where: { targetUserId: { in: userIds }, action: { startsWith: "permissions_" } }, _max: { createdAt: true } }),
  ]);
  for (const id of userIds) {
    const owned = new Set(grants.filter((g) => g.userId === id).map((g) => g.permission));
    const officer = officers.find((o) => o.userId === id);
    states.set(id, {
      permissions: GRANTABLE_PERMISSION_KEYS.filter((k) => owned.has(k)),
      organizationId: officer?.organizationId ?? null,
      organizationName: officer?.organization.name ?? null,
      facility: officer?.facility ?? "",
      changedAt: changes.find((c) => c.targetUserId === id)?._max.createdAt ?? null,
    });
  }
  return states;
}

export async function listPermissionHistory(userId: number, take = 20) {
  const rows = await prisma.institutionOfficerAudit.findMany({
    where: { targetUserId: userId, action: { startsWith: "permissions_" } },
    orderBy: { id: "desc" }, take,
    select: { id: true, action: true, before: true, after: true, reason: true, createdAt: true, actorUserId: true },
  });
  const actors = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorUserId))] } }, select: { id: true, nickname: true } });
  return rows.map((r) => ({ ...r, actorNickname: actors.find((a) => a.id === r.actorUserId)?.nickname ?? null }));
}

export async function listManagementInstitutions() {
  return prisma.organization.findMany({ where: { managementCampus: { not: null }, status: "ACTIVE" }, select: { id: true, name: true, managementCampus: true }, orderBy: [{ managementCampus: "asc" }, { name: "asc" }] });
}

// Current accounts grouped by what they actually hold (not by a stored role):
// a preset's exact set, anything else as 직접 설정, plus full administrators.
export async function summarizePermissionComposition() {
  const [admins, grants] = await Promise.all([
    prisma.user.count({ where: { isAdmin: true, deletedAt: null, withdrawnAt: null } }),
    prisma.adminPermissionGrant.findMany({ where: { user: { isAdmin: false, deletedAt: null, withdrawnAt: null } }, select: { userId: true, permission: true } }),
  ]);
  const byUser = new Map<number, GrantablePermissionKey[]>();
  for (const g of grants) byUser.set(g.userId, [...(byUser.get(g.userId) ?? []), g.permission as GrantablePermissionKey]);
  const counts = new Map<string, number>();
  for (const keys of byUser.values()) {
    const id = matchingPresetId(keys);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const rows = [...PERMISSION_PRESETS.filter((p) => p.id !== "none"), { id: "custom", label: "직접 설정", keys: [] }].map((p) => ({ label: p.label, count: counts.get(p.id) ?? 0 }));
  return { admins, rows };
}
