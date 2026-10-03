import { prisma } from "@/lib/db/prisma";
import { ExternalAccessStatus, Prisma, UserType, type User } from "@/generated/prisma/client";
import type { CreateExternalAccessInput, UpdateExternalAccessInput } from "./schema";

// Admin management of approved external accounts (ExternalAccessGrant).
// Every function re-checks that the caller is an admin even though the
// /admin/external-access server actions already ran requireAdmin(). None of
// this ever touches User.isAdmin: an approved external account is an
// ordinary user.

export type ExternalAccessGrantDTO = {
  id: number;
  email: string;
  name: string;
  affiliation: string;
  campus: string;
  status: "ACTIVE" | "REVOKED";
  createdAt: Date;
  createdByNickname: string | null;
  revokedAt: Date | null;
  revokedByNickname: string | null;
  // The account this email has signed in with, if any yet.
  account: { publicId: string; nickname: string | null } | null;
};

export type ExternalAccessResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "duplicate" };

const GRANT_INCLUDE = {
  createdBy: { select: { nickname: true } },
  revokedBy: { select: { nickname: true } },
} as const;

type GrantRow = Prisma.ExternalAccessGrantGetPayload<{ include: typeof GRANT_INCLUDE }>;

function toDTO(row: GrantRow, account: ExternalAccessGrantDTO["account"]): ExternalAccessGrantDTO {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    affiliation: row.affiliation,
    campus: row.campus,
    status: row.status,
    createdAt: row.createdAt,
    createdByNickname: row.createdBy.nickname,
    revokedAt: row.revokedAt,
    revokedByNickname: row.revokedBy?.nickname ?? null,
    account,
  };
}

async function accountsByEmail(emails: string[]) {
  if (emails.length === 0) return new Map<string, ExternalAccessGrantDTO["account"]>();
  const users = await prisma.user.findMany({
    where: { OR: emails.map((email) => ({ email: { equals: email, mode: "insensitive" as const } })) },
    select: { email: true, publicId: true, nickname: true },
  });
  return new Map(users.map((u) => [u.email.toLowerCase(), { publicId: u.publicId, nickname: u.nickname }]));
}

export async function listExternalAccessGrants(admin: User): Promise<ExternalAccessResult<ExternalAccessGrantDTO[]>> {
  if (!admin.isAdmin) return { kind: "forbidden" };
  const rows = await prisma.externalAccessGrant.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: GRANT_INCLUDE,
  });
  const accounts = await accountsByEmail(rows.map((r) => r.email));
  return { kind: "ok", data: rows.map((r) => toDTO(r, accounts.get(r.email) ?? null)) };
}

// An account that already exists for this email (it may have signed in
// earlier through the test-mode setting) is marked EXTERNAL_VERIFIED right
// away, so it shows the badge without having to sign in again. Never a
// STUDENT account (those are @mju.ac.kr, which can't be granted anyway).
async function markExistingAccountVerified(tx: Prisma.TransactionClient, email: string) {
  await tx.user.updateMany({
    where: { email: { equals: email, mode: "insensitive" }, userType: { not: UserType.STUDENT } },
    data: { userType: UserType.EXTERNAL_VERIFIED },
  });
}

export async function createExternalAccessGrant(
  admin: User,
  input: CreateExternalAccessInput,
): Promise<ExternalAccessResult<{ id: number }>> {
  if (!admin.isAdmin) return { kind: "forbidden" };
  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.externalAccessGrant.create({
        data: {
          email: input.email,
          name: input.name,
          affiliation: input.affiliation,
          campus: input.campus,
          createdByUserId: admin.id,
        },
        select: { id: true },
      });
      await markExistingAccountVerified(tx, input.email);
      return created;
    });
    return { kind: "ok", data: row };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { kind: "duplicate" };
    throw error;
  }
}

export async function updateExternalAccessGrant(
  admin: User,
  id: number,
  input: UpdateExternalAccessInput,
): Promise<ExternalAccessResult<{ id: number }>> {
  if (!admin.isAdmin) return { kind: "forbidden" };
  const { count } = await prisma.externalAccessGrant.updateMany({
    where: { id },
    data: { name: input.name, affiliation: input.affiliation, campus: input.campus },
  });
  return count === 0 ? { kind: "not_found" } : { kind: "ok", data: { id } };
}

// Revoking takes effect at once: the next request from that account fails
// session.ts's per-request check, and it can't sign in again (not even in
// test mode) until re-approved.
export async function revokeExternalAccessGrant(admin: User, id: number): Promise<ExternalAccessResult<{ id: number }>> {
  if (!admin.isAdmin) return { kind: "forbidden" };
  const { count } = await prisma.externalAccessGrant.updateMany({
    where: { id, status: ExternalAccessStatus.ACTIVE },
    data: { status: ExternalAccessStatus.REVOKED, revokedAt: new Date(), revokedByUserId: admin.id },
  });
  if (count === 0) return (await prisma.externalAccessGrant.count({ where: { id } })) ? { kind: "ok", data: { id } } : { kind: "not_found" };
  return { kind: "ok", data: { id } };
}

export async function reactivateExternalAccessGrant(admin: User, id: number): Promise<ExternalAccessResult<{ id: number }>> {
  if (!admin.isAdmin) return { kind: "forbidden" };
  const grant = await prisma.externalAccessGrant.findUnique({ where: { id }, select: { email: true } });
  if (!grant) return { kind: "not_found" };
  await prisma.$transaction(async (tx) => {
    await tx.externalAccessGrant.update({
      where: { id },
      data: { status: ExternalAccessStatus.ACTIVE, revokedAt: null, revokedByUserId: null },
    });
    await markExistingAccountVerified(tx, grant.email);
  });
  return { kind: "ok", data: { id } };
}
