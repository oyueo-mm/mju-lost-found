import { prisma } from "@/lib/db/prisma";

// Shared with mju_activity_audience() in the additive migration.
// External approval alone is NOT a management permission.
export type ActorClassification = { audience: "member" | "internal" | "unclassified"; role: "member" | "service" | "officer" | "unclassified"; organizationId: number | null };
export async function classifyActor(user: { id: number; isAdmin: boolean; email?: string; userType?: string }): Promise<ActorClassification> {
  // Holding at least one admin permission makes an account a management actor
  // (the agency scope, when there is one, is only for per-agency figures).
  const [grant, officer] = await Promise.all([
    prisma.adminPermissionGrant.findFirst({ where: { userId: user.id }, select: { userId: true } }),
    prisma.institutionOfficer.findUnique({ where: { userId: user.id }, select: { active: true, organizationId: true, organization: { select: { status: true, managementCampus: true } } } }),
  ]);
  const organizationId = officer?.active && officer.organization.status === "ACTIVE" && officer.organization.managementCampus ? officer.organizationId : null;
  if (user.isAdmin) return { audience: "internal", role: "service", organizationId };
  if (grant) return { audience: "internal", role: "officer", organizationId };
  if (user.userType === "EXTERNAL_TEST") return { audience: "unclassified", role: "unclassified", organizationId: null };
  return { audience: "member", role: "member", organizationId: null };
}
export async function isManagementActor(user: Parameters<typeof classifyActor>[0]): Promise<boolean> {
  return (await classifyActor(user)).audience === "internal";
}
