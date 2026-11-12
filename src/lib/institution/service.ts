import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { isCurrentlySuspended } from "@/lib/auth/suspension";
import { can } from "@/lib/permissions/check";
import { GRANTABLE_PERMISSION_KEYS, ITEM_PERMISSION_KEYS, PERMISSION_INFO, isGrantablePermissionKey, withRequiredPermissions, type GrantablePermissionKey } from "@/lib/permissions/definitions";
import { institutionSchema, permissionChangeSchema } from "./schema";

type Db = Pick<Prisma.TransactionClient, "user" | "institutionOfficer" | "adminPermissionGrant" | "$queryRaw">;
type AuditDb = Pick<Prisma.TransactionClient, "institutionOfficerAudit">;

function activeAccount(user: { deletedAt: Date | null; withdrawnAt: Date | null } | null | undefined): boolean {
  return Boolean(user && !user.deletedAt && !user.withdrawnAt);
}

// A fresh, DB-sourced view of one account's permissions (never the session's).
export async function loadHolder(userId: number, db: Pick<Prisma.TransactionClient, "user" | "adminPermissionGrant"> = prisma) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !activeAccount(user) || isCurrentlySuspended(user)) return null;
  const grants = user.isAdmin ? [] : await db.adminPermissionGrant.findMany({ where: { userId }, select: { permission: true } });
  return {
    id: user.id,
    isAdmin: user.isAdmin,
    adminPermissions: grants.map((g) => g.permission),
    isSuspended: user.isSuspended,
    suspendedUntil: user.suspendedUntil,
  };
}

// Full administrators only (the permission to manage permissions is not delegable).
export async function serviceAdministrator(userId: number, db: Pick<Prisma.TransactionClient, "user"> = prisma) {
  const user = await db.user.findUnique({ where: { id: userId } });
  return Boolean(user?.isAdmin && activeAccount(user) && !isCurrentlySuspended(user));
}

export type ItemScope = {
  platform: boolean;
  organizationId: number | null;
  institution: string;
  campus: string;
  facility: string;
  // The 물품 관리 permissions this account holds (all five for a full administrator).
  permissions: GrantablePermissionKey[];
};

// Item management needs BOTH a permission for the action and a 관리 범위 (the
// agency whose items the account may handle). A permission without a scope, or a
// scope without a permission, yields no access. Re-read from the DB on each call.
export async function officerScope(userId: number, db: Db = prisma, lock = false): Promise<ItemScope | null> {
  if (lock) await db.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt || user.withdrawnAt || isCurrentlySuspended(user)) return null;
  if (user.isAdmin) return { platform: true, organizationId: null, institution: "전체 관리자", campus: "양쪽", facility: "", permissions: [...ITEM_PERMISSION_KEYS] };
  const grants = await db.adminPermissionGrant.findMany({ where: { userId }, select: { permission: true } });
  const permissions = ITEM_PERMISSION_KEYS.filter((k) => grants.some((g) => g.permission === k));
  if (!permissions.length) return null;
  const grant = await db.institutionOfficer.findUnique({ where: { userId }, include: { organization: true } });
  if (!grant?.active || grant.organization.status !== "ACTIVE" || !grant.organization.managementCampus) return null;
  return { platform: false, organizationId: grant.organizationId, institution: grant.organization.name, campus: grant.organization.managementCampus, facility: grant.facility, permissions };
}

export type PermissionChangeResult =
  | { ok: true; unchanged: boolean; permissions: GrantablePermissionKey[]; added: string[]; removed: string[]; warning?: string }
  | { error: string };

// 관리 권한 부여·변경·회수. One transaction: the target row is locked (the same lock
// item requests take), the change is validated, written and audited together.
export async function setAdminPermissions(actorId: number, raw: unknown): Promise<PermissionChangeResult> {
  const parsed = permissionChangeSchema.safeParse(raw);
  if (!parsed.success) return { error: "입력 내용을 확인해주세요." };
  const v = parsed.data;
  if (v.permissions.some((p) => !isGrantablePermissionKey(p))) return { error: "부여할 수 없는 권한이 포함되어 있습니다." };
  return prisma.$transaction(async (tx) => {
    const actor = await loadHolder(actorId, tx);
    // 권한 관리 is held by full administrators only -- a stored grant can never confer it.
    if (!actor || !can(actor, "permissions.manage")) return { error: "전체 관리자만 관리 권한을 설정할 수 있습니다." };
    if (v.userId === actorId) return { error: "본인의 관리 권한은 직접 변경할 수 없습니다." };
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${v.userId} FOR UPDATE`;
    const target = await tx.user.findUnique({ where: { id: v.userId } });
    if (!target) return { error: "사용자를 찾을 수 없습니다." };
    if (target.isAdmin) return { error: "전체 관리자는 모든 권한을 가지고 있어 개별 설정이 필요 없습니다." };
    const before = await tx.adminPermissionGrant.findMany({ where: { userId: v.userId }, select: { permission: true } });
    const beforeKeys = GRANTABLE_PERMISSION_KEYS.filter((k) => before.some((b) => b.permission === k));
    const next = withRequiredPermissions(v.permissions as GrantablePermissionKey[]);
    const added = next.filter((k) => !beforeKeys.includes(k));
    const removed = beforeKeys.filter((k) => !next.includes(k));
    if (added.length && !activeAccount(target)) return { error: "탈퇴한 계정에는 권한을 부여할 수 없습니다." };
    if (added.length && isCurrentlySuspended(target)) return { error: "정지된 계정에는 권한을 부여할 수 없습니다." };

    const wantsItems = next.some((k) => ITEM_PERMISSION_KEYS.includes(k));
    const officerBefore = await tx.institutionOfficer.findUnique({ where: { userId: v.userId } });
    let scopeAfter = officerBefore;
    let warning: string | undefined;
    if (wantsItems) {
      const organizationId = v.organizationId ?? (officerBefore?.active ? officerBefore.organizationId : null);
      if (!organizationId) return { error: "물품 관리 권한에는 담당 기관을 선택해야 합니다." };
      const organization = await tx.organization.findUnique({ where: { id: organizationId } });
      if (!organization?.managementCampus || organization.status !== "ACTIVE") return { error: "활성 관리 기관을 선택해주세요." };
      const facility = v.facility ?? officerBefore?.facility ?? "";
      if (!officerBefore || !officerBefore.active || officerBefore.organizationId !== organizationId || officerBefore.facility !== facility) {
        scopeAfter = await tx.institutionOfficer.upsert({
          where: { userId: v.userId },
          create: { userId: v.userId, organizationId, facility, active: true, grantedByUserId: actorId },
          update: { organizationId, facility, active: true, grantedByUserId: actorId },
        });
      }
    } else if (officerBefore?.active) {
      scopeAfter = await tx.institutionOfficer.update({ where: { userId: v.userId }, data: { active: false } });
    }
    const scopeChanged = (officerBefore?.active ?? false) !== (scopeAfter?.active ?? false) || officerBefore?.organizationId !== scopeAfter?.organizationId || officerBefore?.facility !== scopeAfter?.facility;
    if (!added.length && !removed.length && !scopeChanged) return { ok: true, unchanged: true, permissions: next, added: [], removed: [] };

    if (removed.length) await tx.adminPermissionGrant.deleteMany({ where: { userId: v.userId, permission: { in: removed } } });
    if (added.length) await tx.adminPermissionGrant.createMany({ data: added.map((permission) => ({ userId: v.userId, permission, grantedByUserId: actorId })), skipDuplicates: true });
    await writeAudit(tx, {
      targetUserId: v.userId, actorUserId: actorId,
      action: !beforeKeys.length && next.length ? "permissions_grant" : beforeKeys.length && !next.length ? "permissions_revoke" : "permissions_update",
      before: { permissions: beforeKeys, organizationId: officerBefore?.active ? officerBefore.organizationId : null, facility: officerBefore?.active ? officerBefore.facility : null },
      after: { permissions: next, organizationId: scopeAfter?.active ? scopeAfter.organizationId : null, facility: scopeAfter?.active ? scopeAfter.facility : null },
      reason: v.reason || null,
    });
    if (officerBefore?.active && (!scopeAfter?.active || officerBefore.organizationId !== scopeAfter.organizationId)) {
      const remaining = await tx.adminPermissionGrant.count({ where: { permission: { in: ITEM_PERMISSION_KEYS }, user: { id: { not: v.userId }, deletedAt: null, withdrawnAt: null, isSuspended: false, institutionOfficer: { is: { active: true, organizationId: officerBefore.organizationId } } } } });
      const items = await tx.foundPost.count({ where: { custodyOrganizationId: officerBefore.organizationId, status: "KEEPING" } });
      if (!remaining && items) warning = `기존 기관에 보관 중인 물품 ${items}건이 있지만 물품 관리 권한을 가진 다른 담당자가 없습니다. 다른 담당자를 지정해주세요.`;
    }
    return { ok: true, unchanged: false, permissions: next, added: added.map((k) => PERMISSION_INFO[k].label), removed: removed.map((k) => PERMISSION_INFO[k].label), warning };
  });
}

async function writeAudit(tx: AuditDb, data: { targetUserId?: number; actorUserId: number; action: string; before?: unknown; after?: unknown; reason?: string | null }) {
  await tx.institutionOfficerAudit.create({ data: {
    targetUserId: data.targetUserId, actorUserId: data.actorUserId, action: data.action,
    before: data.before === undefined ? Prisma.JsonNull : JSON.parse(JSON.stringify(data.before)),
    after: data.after === undefined ? Prisma.JsonNull : JSON.parse(JSON.stringify(data.after)),
    reason: data.reason ?? null,
  } });
}

// 기관 관리: register or update an agency that holds found items.
export async function saveInstitution(actorId: number, raw: unknown) {
  const parsed = institutionSchema.safeParse(raw);
  if (!parsed.success) return { error: "기관명과 캠퍼스를 확인해주세요." };
  return prisma.$transaction(async (tx) => {
    const actor = await loadHolder(actorId, tx);
    if (!actor || !can(actor, "institutions.manage")) return { error: "기관 관리 권한이 필요합니다." };
    const v = parsed.data;
    if (v.organizationId) {
      const existing = await tx.organization.findUnique({ where: { id: v.organizationId } });
      if (!existing || existing.status !== "ACTIVE") return { error: "활성 조직을 선택해주세요." };
      if (existing.managementCampus && existing.managementCampus !== v.campus) return { error: "이미 등록된 관리 기관의 캠퍼스는 변경할 수 없습니다. 다른 캠퍼스의 기관을 별도로 등록해주세요." };
    }
    const org = v.organizationId ? await tx.organization.update({ where: { id: v.organizationId }, data: { managementCampus: v.campus } })
      : await tx.organization.create({ data: { name: v.name, organizationType: v.type, scope: v.campus, managementCampus: v.campus } });
    await writeAudit(tx, { actorUserId: actorId, action: "institution_create", after: { organizationId: org.id, ...v } });
    return { ok: true };
  });
}
