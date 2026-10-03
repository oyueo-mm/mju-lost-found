import { beforeEach, describe, expect, it, vi } from "vitest";

class FakeKnownError extends Error {
  code: string;
  constructor(code: string) {
    super("prisma");
    this.code = code;
  }
}

const externalAccessGrant = { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), update: vi.fn(), findUnique: vi.fn(), count: vi.fn() };
const user = { findMany: vi.fn(), updateMany: vi.fn() };
const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn({ externalAccessGrant, user }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { externalAccessGrant, user, $transaction } }));
vi.mock("@/generated/prisma/client", () => ({
  ExternalAccessStatus: { ACTIVE: "ACTIVE", REVOKED: "REVOKED" },
  UserType: { STUDENT: "STUDENT", EXTERNAL_VERIFIED: "EXTERNAL_VERIFIED", EXTERNAL_TEST: "EXTERNAL_TEST" },
  Prisma: { PrismaClientKnownRequestError: FakeKnownError },
}));

const { createExternalAccessGrant, listExternalAccessGrants, reactivateExternalAccessGrant, revokeExternalAccessGrant, updateExternalAccessGrant } =
  await import("./service");
const { createExternalAccessSchema } = await import("./schema");

const admin = { id: 1, isAdmin: true } as never;
const nonAdmin = { id: 2, isAdmin: false } as never;
const input = { email: "guard@gmail.com", name: "홍길동", affiliation: "종합관 경비실", campus: "인문캠퍼스" as const };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("admin-only", () => {
  it("refuses every operation for a non-admin, touching nothing", async () => {
    expect(await listExternalAccessGrants(nonAdmin)).toEqual({ kind: "forbidden" });
    expect(await createExternalAccessGrant(nonAdmin, input)).toEqual({ kind: "forbidden" });
    expect(await updateExternalAccessGrant(nonAdmin, 1, input)).toEqual({ kind: "forbidden" });
    expect(await revokeExternalAccessGrant(nonAdmin, 1)).toEqual({ kind: "forbidden" });
    expect(await reactivateExternalAccessGrant(nonAdmin, 1)).toEqual({ kind: "forbidden" });
    expect(externalAccessGrant.create).not.toHaveBeenCalled();
    expect(externalAccessGrant.updateMany).not.toHaveBeenCalled();
  });
});

describe("createExternalAccessGrant", () => {
  it("creates an ACTIVE approval and marks an existing non-student account EXTERNAL_VERIFIED -- never an admin", async () => {
    externalAccessGrant.create.mockResolvedValueOnce({ id: 9 });

    expect(await createExternalAccessGrant(admin, input)).toEqual({ kind: "ok", data: { id: 9 } });
    expect(externalAccessGrant.create).toHaveBeenCalledWith({
      data: { ...input, createdByUserId: 1 },
      select: { id: true },
    });
    expect(user.updateMany).toHaveBeenCalledWith({
      where: { email: { equals: "guard@gmail.com", mode: "insensitive" }, userType: { not: "STUDENT" } },
      data: { userType: "EXTERNAL_VERIFIED" },
    });
    expect(JSON.stringify(user.updateMany.mock.calls)).not.toContain("isAdmin");
  });

  it("reports a duplicate email instead of throwing", async () => {
    externalAccessGrant.create.mockRejectedValueOnce(new FakeKnownError("P2002"));
    expect(await createExternalAccessGrant(admin, input)).toEqual({ kind: "duplicate" });
  });
});

describe("revoke / reactivate", () => {
  it("revoking records who and when", async () => {
    externalAccessGrant.updateMany.mockResolvedValueOnce({ count: 1 });

    expect(await revokeExternalAccessGrant(admin, 9)).toEqual({ kind: "ok", data: { id: 9 } });
    expect(externalAccessGrant.updateMany).toHaveBeenCalledWith({
      where: { id: 9, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: expect.any(Date), revokedByUserId: 1 },
    });
  });

  it("revoking an unknown id is not_found", async () => {
    externalAccessGrant.updateMany.mockResolvedValueOnce({ count: 0 });
    externalAccessGrant.count.mockResolvedValueOnce(0);
    expect(await revokeExternalAccessGrant(admin, 404)).toEqual({ kind: "not_found" });
  });

  it("re-approving clears the revocation and re-marks the account", async () => {
    externalAccessGrant.findUnique.mockResolvedValueOnce({ email: "guard@gmail.com" });

    expect(await reactivateExternalAccessGrant(admin, 9)).toEqual({ kind: "ok", data: { id: 9 } });
    expect(externalAccessGrant.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { status: "ACTIVE", revokedAt: null, revokedByUserId: null },
    });
    expect(user.updateMany).toHaveBeenCalled();
  });
});

describe("createExternalAccessSchema", () => {
  it("lower-cases the email and rejects @mju.ac.kr (those never need approval)", () => {
    const ok = createExternalAccessSchema.safeParse({ ...input, email: "  Guard@Gmail.COM " });
    expect(ok.success && ok.data.email).toBe("guard@gmail.com");
    expect(createExternalAccessSchema.safeParse({ ...input, email: "a@mju.ac.kr" }).success).toBe(false);
    expect(createExternalAccessSchema.safeParse({ ...input, email: "not-an-email" }).success).toBe(false);
    expect(createExternalAccessSchema.safeParse({ ...input, campus: "본교" }).success).toBe(false);
  });
});
