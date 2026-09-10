import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 12-4 §8: same fake shape chat/service.test.ts already uses to
// simulate a Prisma P2002 unique-constraint error without a real DB.
class FakePrismaClientKnownRequestError extends Error {
  code: string;
  constructor(code: string) {
    super("mock prisma error");
    this.code = code;
  }
}

const organization = {
  create: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  count: vi.fn(),
};
const organizationMember = {
  create: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  count: vi.fn(),
};
const organizationCreationRequest = {
  create: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
};
const organizationJoinRequest = {
  create: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
};
const notification = { create: vi.fn() };
const queryRaw = vi.fn();

// Phase 12-2: same "$transaction runs the callback against a fake tx
// object built from these same top-level mocks" convention every other
// *.service.test.ts in this app already uses (announcement/service.test.ts,
// comment/service.test.ts, ...) -- so an assertion against e.g.
// `organizationMember.create` passes whether the real call happened inside
// or outside a transaction.
const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) =>
  fn({ organization, organizationMember, organizationCreationRequest, organizationJoinRequest, notification, $queryRaw: queryRaw }),
);

vi.mock("@/lib/db/prisma", () => ({
  prisma: { organization, organizationMember, organizationCreationRequest, organizationJoinRequest, notification, $transaction },
}));
vi.mock("@/lib/moderation/service", () => ({ isAdmin: (u: { isAdmin: boolean }) => u.isAdmin }));
vi.mock("@/generated/prisma/client", () => ({
  OrganizationRole: { LEADER: "LEADER", ADMIN: "ADMIN", MEMBER: "MEMBER" },
  OrganizationStatus: { ACTIVE: "ACTIVE", INACTIVE: "INACTIVE" },
  OrganizationRequestStatus: { PENDING: "PENDING", APPROVED: "APPROVED", REJECTED: "REJECTED", CANCELLED: "CANCELLED" },
  NotificationType: { ORGANIZATION_REQUEST_PROCESSED: "ORGANIZATION_REQUEST_PROCESSED" },
  Prisma: { PrismaClientKnownRequestError: FakePrismaClientKnownRequestError },
}));

const {
  createOrganization,
  updateOrganizationProfile,
  getOrganizationById,
  listActiveOrganizations,
  getOrganizationMember,
  getOrganizationMembers,
  isOrganizationMember,
  getOrganizationRole,
  getMyOrganizationMemberships,
  getMyOrganizationJoinRequests,
  getMyPendingJoinRequest,
  listJoinRequestsForOrganization,
  validateOrganizationPosting,
  listOrganizationsForAdmin,
  getOrganizationForAdmin,
  setOrganizationStatusForAdmin,
  createOrganizationCreationRequest,
  getMyPendingOrganizationCreationRequest,
  listOrganizationCreationRequestsForAdmin,
  getOrganizationCreationRequestForAdmin,
  cancelOrganizationCreationRequest,
  approveOrganizationCreationRequest,
  rejectOrganizationCreationRequest,
  createJoinRequest,
  cancelJoinRequest,
  approveJoinRequest,
  rejectJoinRequest,
  appointAdmin,
  removeAdmin,
  removeMember,
  leaveOrganization,
  transferLeadership,
  deactivateOrganization,
} = await import("./service");

const admin = { id: 1, isAdmin: true };
const nonAdmin = { id: 2, isAdmin: false };

const orgRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 10,
  name: "명지대학교 총학생회",
  description: null,
  organizationType: "학생회",
  scope: "전체",
  contactEmail: "council@mju.ac.kr",
  status: "ACTIVE",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  ...overrides,
});

const memberRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  organizationId: 10,
  userId: 2,
  role: "MEMBER",
  joinedAt: new Date("2026-01-01"),
  user: { id: 2, nickname: "닉네임", publicId: "pub-2" },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  queryRaw.mockResolvedValue([]);
  // createOrganizationCreationRequest's own duplicate-PENDING pre-check --
  // defaults to "no existing pending request" so every test that doesn't
  // care about that policy is unaffected.
  organizationCreationRequest.findFirst.mockResolvedValue(null);
});

describe("Organization 기본 조회", () => {
  it("getOrganizationById: DTO 변환 및 status 문자열 변환", async () => {
    organization.findUnique.mockResolvedValueOnce(orgRow());
    const result = await getOrganizationById(10);
    expect(result?.status).toBe("active");
  });

  it("getOrganizationById: 존재하지 않으면 null", async () => {
    organization.findUnique.mockResolvedValueOnce(null);
    expect(await getOrganizationById(999)).toBeNull();
  });

  it("listActiveOrganizations: ACTIVE 조직만 조회", async () => {
    organization.findMany.mockResolvedValueOnce([orgRow()]);
    const result = await listActiveOrganizations();
    expect(organization.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "ACTIVE" } }));
    expect(result).toHaveLength(1);
  });

  it("getOrganizationMember: 존재하면 DTO, 없으면 null", async () => {
    organizationMember.findUnique.mockResolvedValueOnce(memberRow({ role: "LEADER" }));
    const found = await getOrganizationMember(10, 2);
    expect(found?.role).toBe("leader");

    organizationMember.findUnique.mockResolvedValueOnce(null);
    expect(await getOrganizationMember(10, 999)).toBeNull();
  });

  it("isOrganizationMember: true/false", async () => {
    organizationMember.findUnique.mockResolvedValueOnce({ id: 1 });
    expect(await isOrganizationMember(10, 2)).toBe(true);

    organizationMember.findUnique.mockResolvedValueOnce(null);
    expect(await isOrganizationMember(10, 999)).toBe(false);
  });

  it("getOrganizationRole: role 문자열 또는 null", async () => {
    organizationMember.findUnique.mockResolvedValueOnce({ role: "ADMIN" });
    expect(await getOrganizationRole(10, 2)).toBe("admin");

    organizationMember.findUnique.mockResolvedValueOnce(null);
    expect(await getOrganizationRole(10, 999)).toBeNull();
  });
});

describe("getMyOrganizationMemberships (Phase 12-4 §23)", () => {
  it("본인의 멤버십을 organization 정보와 함께 반환한다 (개인정보 없음)", async () => {
    organizationMember.findMany.mockResolvedValueOnce([
      { role: "LEADER", organization: { id: 10, name: "총학생회", status: "ACTIVE" } },
      { role: "MEMBER", organization: { id: 11, name: "동아리", status: "INACTIVE" } },
    ]);

    const result = await getMyOrganizationMemberships(2);

    expect(result).toEqual([
      { organizationId: 10, organizationName: "총학생회", organizationStatus: "active", role: "leader" },
      { organizationId: 11, organizationName: "동아리", organizationStatus: "inactive", role: "member" },
    ]);
  });
});

describe("getMyOrganizationJoinRequests (Phase 12-10 §5)", () => {
  it("본인이 낸 가입 신청 전체를 단체명과 함께, 최신순으로 반환한다 (개인정보 없음)", async () => {
    organizationJoinRequest.findMany.mockResolvedValueOnce([
      {
        id: 61,
        organizationId: 11,
        status: "PENDING",
        rejectionReason: null,
        createdAt: new Date("2026-02-01"),
        organization: { name: "AI 동아리" },
      },
      {
        id: 55,
        organizationId: 10,
        status: "APPROVED",
        rejectionReason: null,
        createdAt: new Date("2026-01-01"),
        organization: { name: "개발 동아리" },
      },
    ]);

    const result = await getMyOrganizationJoinRequests(2);

    expect(result).toEqual([
      {
        id: 61,
        organizationId: 11,
        organizationName: "AI 동아리",
        status: "pending",
        rejectionReason: null,
        createdAt: new Date("2026-02-01"),
      },
      {
        id: 55,
        organizationId: 10,
        organizationName: "개발 동아리",
        status: "approved",
        rejectionReason: null,
        createdAt: new Date("2026-01-01"),
      },
    ]);
    expect(organizationJoinRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 2 }, orderBy: [{ createdAt: "desc" }] }),
    );
  });

  it("신청 내역이 없으면 빈 배열을 반환한다", async () => {
    organizationJoinRequest.findMany.mockResolvedValueOnce([]);
    expect(await getMyOrganizationJoinRequests(2)).toEqual([]);
  });
});

describe("getMyPendingJoinRequest (Phase 12-4 §9)", () => {
  it("PENDING 요청이 있으면 id 반환, 없으면 null", async () => {
    organizationJoinRequest.findFirst.mockResolvedValueOnce({ id: 55 });
    expect(await getMyPendingJoinRequest(10, 2)).toEqual({ id: 55 });

    organizationJoinRequest.findFirst.mockResolvedValueOnce(null);
    expect(await getMyPendingJoinRequest(10, 2)).toBeNull();
  });
});

// Phase 12-5 §6/§8: the single gate posts/aiService.ts and
// comment/service.ts both call before writing a client-supplied
// organizationId into a LostPost/FoundPost/Comment row. authz.ts is not
// mocked in this file (see the top-of-file convention every other
// canManageMembers/canAppointAdmin-driven test here already relies on),
// so canPostAsOrganization runs for real against these same prisma mocks.
describe("validateOrganizationPosting (Phase 12-5)", () => {
  it("nonexistent organization -- not_found", async () => {
    organization.findUnique.mockResolvedValueOnce(null);
    expect(await validateOrganizationPosting(2, 999)).toEqual({ kind: "not_found" });
  });

  it("INACTIVE organization -- inactive_organization, even for an existing member", async () => {
    organization.findUnique.mockResolvedValueOnce(orgRow({ status: "INACTIVE" }));
    const result = await validateOrganizationPosting(2, 10);
    expect(result).toEqual({ kind: "inactive_organization" });
    // canPostAsOrganization's own INACTIVE short-circuit means membership
    // is never even queried -- see that function's own comment.
    expect(organizationMember.findUnique).not.toHaveBeenCalled();
  });

  it("ACTIVE organization + non-member -- forbidden", async () => {
    organization.findUnique.mockResolvedValueOnce(orgRow({ status: "ACTIVE" }));
    organization.findUnique.mockResolvedValueOnce({ status: "ACTIVE" }); // canPostAsOrganization's own re-fetch
    organizationMember.findUnique.mockResolvedValueOnce(null);
    expect(await validateOrganizationPosting(2, 10)).toEqual({ kind: "forbidden" });
  });

  it("ACTIVE organization + active member (any role) -- ok", async () => {
    organization.findUnique.mockResolvedValueOnce(orgRow({ status: "ACTIVE" }));
    organization.findUnique.mockResolvedValueOnce({ status: "ACTIVE" });
    organizationMember.findUnique.mockResolvedValueOnce(memberRow({ role: "MEMBER" }));
    expect(await validateOrganizationPosting(2, 10)).toEqual({ kind: "ok" });
  });

  // §31 role spoofing: validateOrganizationPosting's signature is
  // (userId, organizationId) only -- there is no role parameter to spoof,
  // and canPostAsOrganization/getMembership always re-derive the actual
  // role fresh from organizationMember.findUnique, never from anything
  // the caller supplies.
  it("membership role is always re-derived from the DB, never trusted from a caller-supplied value", async () => {
    organization.findUnique.mockResolvedValueOnce(orgRow({ status: "ACTIVE" }));
    organization.findUnique.mockResolvedValueOnce({ status: "ACTIVE" });
    // Even though this row's role happens to be MEMBER (the lowest
    // privilege), the function still returns ok -- proving posting only
    // ever requires *membership*, not any particular role, and that role
    // is read from the DB row itself, not any input parameter.
    organizationMember.findUnique.mockResolvedValueOnce(memberRow({ role: "MEMBER" }));
    expect(await validateOrganizationPosting(2, 10)).toEqual({ kind: "ok" });
    expect(organizationMember.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId_userId: { organizationId: 10, userId: 2 } } }),
    );
  });
});

describe("listJoinRequestsForOrganization (Phase 12-4 §12)", () => {
  it("LEADER/ADMIN이 아니면 forbidden", async () => {
    organizationMember.findUnique.mockResolvedValueOnce(memberRow({ role: "MEMBER" }));
    expect(await listJoinRequestsForOrganization(2, 10)).toEqual({ kind: "forbidden" });
    expect(organizationJoinRequest.findMany).not.toHaveBeenCalled();
  });

  it("ADMIN 이상이면 신청 목록 DTO 반환", async () => {
    organizationMember.findUnique.mockResolvedValueOnce(memberRow({ role: "ADMIN" }));
    organizationJoinRequest.findMany.mockResolvedValueOnce([
      {
        id: 55,
        organizationId: 10,
        message: "가입하고 싶습니다",
        status: "PENDING",
        rejectionReason: null,
        createdAt: new Date("2026-01-01"),
        user: { id: 2, nickname: "닉네임", publicId: "pub-2" },
      },
    ]);

    const result = await listJoinRequestsForOrganization(3, 10);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data[0]).toEqual(
        expect.objectContaining({ id: 55, status: "pending", requester: { id: 2, nickname: "닉네임", publicId: "pub-2" } }),
      );
    }
  });
});

describe("createOrganization (내부 전용)", () => {
  it("Organization과 LEADER 멤버십을 하나의 트랜잭션에서 생성한다", async () => {
    organization.create.mockResolvedValueOnce(orgRow());

    const result = await createOrganization(
      { name: "명지대학교 총학생회", organizationType: "학생회", contactEmail: "council@mju.ac.kr" },
      5,
    );

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(organization.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: "명지대학교 총학생회" }) }),
    );
    expect(organizationMember.create).toHaveBeenCalledWith({
      data: { organizationId: 10, userId: 5, role: "LEADER" },
    });
    expect(result.id).toBe(10);

    const orgCreateOrder = organization.create.mock.invocationCallOrder[0];
    const memberCreateOrder = organizationMember.create.mock.invocationCallOrder[0];
    expect(orgCreateOrder).toBeLessThan(memberCreateOrder);
  });
});

// Phase 12-4 §10/§11: canManageOrganization(ADMIN 이상)을 실제로 사용하는
// 첫 서비스 함수 -- authz.ts는 여기서 mocking하지 않고 실제 canManageOrganization
// 이 이 파일의 prisma mock을 통해 그대로 동작하도록 둔다 (다른 서비스 함수들이
// canManageMembers/canAppointAdmin 등을 검증하는 것과 동일한 방식).
describe("updateOrganizationProfile", () => {
  const validInput = {
    name: "새 이름",
    organizationType: "동아리",
    description: "설명",
    scope: "명지대",
    contactEmail: "new@mju.ac.kr",
  };

  it("LEADER: 수정 가능", async () => {
    organizationMember.findUnique.mockResolvedValueOnce(memberRow({ role: "LEADER" }));
    organization.findUnique.mockResolvedValueOnce(orgRow());
    organization.update.mockResolvedValueOnce(orgRow(validInput));

    const result = await updateOrganizationProfile(1, 10, validInput);

    expect(result.kind).toBe("ok");
    expect(organization.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: {
        name: "새 이름",
        organizationType: "동아리",
        description: "설명",
        scope: "명지대",
        contactEmail: "new@mju.ac.kr",
      },
    });
  });

  it("ADMIN: 수정 가능", async () => {
    organizationMember.findUnique.mockResolvedValueOnce(memberRow({ role: "ADMIN" }));
    organization.findUnique.mockResolvedValueOnce(orgRow());
    organization.update.mockResolvedValueOnce(orgRow(validInput));

    expect((await updateOrganizationProfile(1, 10, validInput)).kind).toBe("ok");
  });

  it("MEMBER: forbidden", async () => {
    organizationMember.findUnique.mockResolvedValueOnce(memberRow({ role: "MEMBER" }));
    expect(await updateOrganizationProfile(1, 10, validInput)).toEqual({ kind: "forbidden" });
  });

  it("non-member: forbidden", async () => {
    organizationMember.findUnique.mockResolvedValueOnce(null);
    expect(await updateOrganizationProfile(1, 10, validInput)).toEqual({ kind: "forbidden" });
  });

  it("존재하지 않는 조직: not_found", async () => {
    organizationMember.findUnique.mockResolvedValueOnce(memberRow({ role: "LEADER" }));
    organization.findUnique.mockResolvedValueOnce(null);
    expect(await updateOrganizationProfile(1, 999, validInput)).toEqual({ kind: "not_found" });
  });

  it("OrganizationStatus는 수정 데이터에 포함되지 않는다", async () => {
    organizationMember.findUnique.mockResolvedValueOnce(memberRow({ role: "LEADER" }));
    organization.findUnique.mockResolvedValueOnce(orgRow());
    organization.update.mockResolvedValueOnce(orgRow(validInput));

    await updateOrganizationProfile(1, 10, validInput);

    const callArgs = organization.update.mock.calls[0][0];
    expect(callArgs.data).not.toHaveProperty("status");
  });
});

describe("Organization Creation Request", () => {
  it("createOrganizationCreationRequest: PENDING 요청 생성", async () => {
    organizationCreationRequest.create.mockResolvedValueOnce({ id: 100 });
    const result = await createOrganizationCreationRequest(nonAdmin as never, {
      organizationName: "AI 동아리",
      organizationType: "동아리",
      contactEmail: "ai-club@mju.ac.kr",
      purpose: "인공지능 스터디 및 프로젝트",
    });
    expect(result).toEqual({ kind: "ok", data: { id: 100 } });
    expect(organizationCreationRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ requestedByUserId: 2 }) }),
    );
  });

  // Phase 12-3 §6: 같은 사용자가 이미 PENDING 신청을 가지고 있으면 새 신청을
  // 만들 수 없다. APPROVED/REJECTED/CANCELLED는 막지 않는다(재신청 허용).
  it("createOrganizationCreationRequest: 이미 PENDING 신청이 있으면 duplicate_pending_request", async () => {
    organizationCreationRequest.findFirst.mockResolvedValueOnce({ id: 99 });

    const result = await createOrganizationCreationRequest(nonAdmin as never, {
      organizationName: "AI 동아리",
      organizationType: "동아리",
      contactEmail: "ai-club@mju.ac.kr",
      purpose: "인공지능 스터디 및 프로젝트",
    });

    expect(result).toEqual({ kind: "duplicate_pending_request" });
    expect(organizationCreationRequest.create).not.toHaveBeenCalled();
  });

  it("createOrganizationCreationRequest: 이전 신청이 REJECTED/CANCELLED/APPROVED면 재신청 허용", async () => {
    organizationCreationRequest.findFirst.mockResolvedValueOnce(null); // PENDING만 조회하므로 과거 처리된 신청은 여기 안 걸림
    organizationCreationRequest.create.mockResolvedValueOnce({ id: 101 });

    const result = await createOrganizationCreationRequest(nonAdmin as never, {
      organizationName: "AI 동아리",
      organizationType: "동아리",
      contactEmail: "ai-club@mju.ac.kr",
      purpose: "재신청입니다",
    });

    expect(result).toEqual({ kind: "ok", data: { id: 101 } });
  });

  describe("getMyPendingOrganizationCreationRequest", () => {
    it("PENDING 신청이 있으면 반환", async () => {
      organizationCreationRequest.findFirst.mockResolvedValueOnce({
        id: 100,
        organizationName: "AI 동아리",
        organizationType: "동아리",
        scope: null,
        contactEmail: "ai-club@mju.ac.kr",
        purpose: "목적",
        status: "PENDING",
        rejectionReason: null,
        adminNote: null,
        reviewedAt: null,
        resultingOrganizationId: null,
        createdAt: new Date("2026-01-01"),
      });

      const result = await getMyPendingOrganizationCreationRequest(2);

      expect(result?.status).toBe("pending");
      expect(organizationCreationRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { requestedByUserId: 2, status: "PENDING" } }),
      );
    });

    it("PENDING 신청이 없으면 null", async () => {
      organizationCreationRequest.findFirst.mockResolvedValueOnce(null);
      expect(await getMyPendingOrganizationCreationRequest(2)).toBeNull();
    });
  });

  describe("listOrganizationCreationRequestsForAdmin / getOrganizationCreationRequestForAdmin", () => {
    it("Platform Admin이 아니면 목록 조회 forbidden", async () => {
      const result = await listOrganizationCreationRequestsForAdmin(nonAdmin as never, { page: 1, limit: 20 });
      expect(result).toEqual({ kind: "forbidden" });
      expect(organizationCreationRequest.findMany).not.toHaveBeenCalled();
    });

    it("목록 조회: 신청자 정보 포함, 최신순", async () => {
      organizationCreationRequest.findMany.mockResolvedValueOnce([
        {
          id: 100,
          organizationName: "AI 동아리",
          organizationType: "동아리",
          scope: null,
          contactEmail: "ai-club@mju.ac.kr",
          purpose: "목적",
          status: "PENDING",
          rejectionReason: null,
          adminNote: null,
          reviewedAt: null,
          resultingOrganizationId: null,
          createdAt: new Date("2026-01-01"),
          requestedBy: { id: 2, nickname: "신청자닉네임", publicId: "pub-2" },
          reviewedBy: null,
        },
      ]);
      organizationCreationRequest.count.mockResolvedValueOnce(1);

      const result = await listOrganizationCreationRequestsForAdmin(admin as never, { page: 1, limit: 20 });

      expect(result.kind).toBe("ok");
      if (result.kind === "ok") {
        expect(result.data.items[0].requester.nickname).toBe("신청자닉네임");
        expect(result.data.total).toBe(1);
      }
      expect(organizationCreationRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
      );
    });

    it("status 필터가 주어지면 where에 반영", async () => {
      organizationCreationRequest.findMany.mockResolvedValueOnce([]);
      organizationCreationRequest.count.mockResolvedValueOnce(0);

      await listOrganizationCreationRequestsForAdmin(admin as never, { status: "pending", page: 1, limit: 20 });

      expect(organizationCreationRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "PENDING" } }));
    });

    it("Platform Admin이 아니면 상세 조회 forbidden", async () => {
      const result = await getOrganizationCreationRequestForAdmin(nonAdmin as never, 100);
      expect(result).toEqual({ kind: "forbidden" });
      expect(organizationCreationRequest.findUnique).not.toHaveBeenCalled();
    });

    it("존재하지 않으면 not_found", async () => {
      organizationCreationRequest.findUnique.mockResolvedValueOnce(null);
      expect(await getOrganizationCreationRequestForAdmin(admin as never, 999)).toEqual({ kind: "not_found" });
    });

    it("상세 조회: 승인된 요청은 resultingOrganizationId를 포함", async () => {
      organizationCreationRequest.findUnique.mockResolvedValueOnce({
        id: 100,
        organizationName: "AI 동아리",
        organizationType: "동아리",
        scope: null,
        contactEmail: "ai-club@mju.ac.kr",
        purpose: "목적",
        status: "APPROVED",
        rejectionReason: null,
        adminNote: null,
        reviewedAt: new Date("2026-01-02"),
        resultingOrganizationId: 20,
        createdAt: new Date("2026-01-01"),
        requestedBy: { id: 2, nickname: "신청자", publicId: "pub-2" },
        reviewedBy: { id: 1, nickname: "관리자", publicId: "pub-1" },
      });

      const result = await getOrganizationCreationRequestForAdmin(admin as never, 100);

      expect(result.kind).toBe("ok");
      if (result.kind === "ok") {
        expect(result.data.resultingOrganizationId).toBe(20);
        expect(result.data.reviewedBy?.nickname).toBe("관리자");
      }
    });
  });

  describe("cancelOrganizationCreationRequest", () => {
    it("본인 신청만 취소 가능", async () => {
      organizationCreationRequest.findUnique.mockResolvedValueOnce({ id: 100, requestedByUserId: 2, status: "PENDING" });
      const result = await cancelOrganizationCreationRequest(999, 100);
      expect(result).toEqual({ kind: "forbidden" });
      expect(organizationCreationRequest.updateMany).not.toHaveBeenCalled();
    });

    it("존재하지 않으면 not_found", async () => {
      organizationCreationRequest.findUnique.mockResolvedValueOnce(null);
      expect(await cancelOrganizationCreationRequest(2, 999)).toEqual({ kind: "not_found" });
    });

    it("PENDING 상태에서만 취소 가능 -- 이미 처리된 요청은 invalid_state", async () => {
      organizationCreationRequest.findUnique.mockResolvedValueOnce({ id: 100, requestedByUserId: 2, status: "PENDING" });
      organizationCreationRequest.updateMany.mockResolvedValueOnce({ count: 0 });
      expect(await cancelOrganizationCreationRequest(2, 100)).toEqual({ kind: "invalid_state" });
    });

    it("성공 시 CANCELLED로 전환", async () => {
      organizationCreationRequest.findUnique.mockResolvedValueOnce({ id: 100, requestedByUserId: 2, status: "PENDING" });
      organizationCreationRequest.updateMany.mockResolvedValueOnce({ count: 1 });
      expect(await cancelOrganizationCreationRequest(2, 100)).toEqual({ kind: "ok", data: { id: 100 } });
    });
  });

  describe("approveOrganizationCreationRequest", () => {
    it("Platform Admin이 아니면 forbidden", async () => {
      const result = await approveOrganizationCreationRequest(nonAdmin as never, 100);
      expect(result).toEqual({ kind: "forbidden" });
      expect(organizationCreationRequest.findUnique).not.toHaveBeenCalled();
    });

    it("존재하지 않으면 not_found", async () => {
      organizationCreationRequest.findUnique.mockResolvedValueOnce(null);
      expect(await approveOrganizationCreationRequest(admin as never, 999)).toEqual({ kind: "not_found" });
    });

    it("동시 이중 승인 방어 -- updateMany가 0건이면 invalid_state", async () => {
      organizationCreationRequest.findUnique.mockResolvedValueOnce({
        id: 100,
        requestedByUserId: 5,
        organizationName: "AI 동아리",
        organizationType: "동아리",
        scope: null,
        contactEmail: "ai-club@mju.ac.kr",
        status: "PENDING",
      });
      organizationCreationRequest.updateMany.mockResolvedValueOnce({ count: 0 });

      const result = await approveOrganizationCreationRequest(admin as never, 100);

      expect(result).toEqual({ kind: "invalid_state" });
      expect(organization.create).not.toHaveBeenCalled();
    });

    it("승인 시 Organization 생성 + LEADER 멤버십 + resultingOrganizationId를 한 트랜잭션에서 처리", async () => {
      organizationCreationRequest.findUnique.mockResolvedValueOnce({
        id: 100,
        requestedByUserId: 5,
        organizationName: "AI 동아리",
        organizationType: "동아리",
        scope: "전체",
        contactEmail: "ai-club@mju.ac.kr",
        status: "PENDING",
      });
      organizationCreationRequest.updateMany.mockResolvedValueOnce({ count: 1 });
      organization.create.mockResolvedValueOnce(orgRow({ id: 20, name: "AI 동아리" }));

      const result = await approveOrganizationCreationRequest(admin as never, 100);

      expect(result).toEqual({ kind: "ok", data: { organizationId: 20 } });
      expect(organizationMember.create).toHaveBeenCalledWith({ data: { organizationId: 20, userId: 5, role: "LEADER" } });
      expect(organizationCreationRequest.update).toHaveBeenCalledWith({
        where: { id: 100 },
        data: { resultingOrganizationId: 20 },
      });
    });

    // Phase 12-3 §13: 신청자 1명에게만, fan-out 없이.
    it("승인 시 신청자 1명에게만 알림을 생성한다", async () => {
      organizationCreationRequest.findUnique.mockResolvedValueOnce({
        id: 100,
        requestedByUserId: 5,
        organizationName: "AI 동아리",
        organizationType: "동아리",
        scope: "전체",
        contactEmail: "ai-club@mju.ac.kr",
        status: "PENDING",
      });
      organizationCreationRequest.updateMany.mockResolvedValueOnce({ count: 1 });
      organization.create.mockResolvedValueOnce(orgRow({ id: 20, name: "AI 동아리" }));

      await approveOrganizationCreationRequest(admin as never, 100);

      expect(notification.create).toHaveBeenCalledTimes(1);
      expect(notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 5,
          type: "ORGANIZATION_REQUEST_PROCESSED",
          relatedType: "organization_creation_request",
          relatedId: 100,
        }),
      });
    });

    it("동시 이중 승인 시에는 알림도 생성하지 않는다", async () => {
      organizationCreationRequest.findUnique.mockResolvedValueOnce({
        id: 100,
        requestedByUserId: 5,
        organizationName: "AI 동아리",
        organizationType: "동아리",
        scope: null,
        contactEmail: "ai-club@mju.ac.kr",
        status: "PENDING",
      });
      organizationCreationRequest.updateMany.mockResolvedValueOnce({ count: 0 });

      await approveOrganizationCreationRequest(admin as never, 100);

      expect(notification.create).not.toHaveBeenCalled();
    });
  });

  describe("rejectOrganizationCreationRequest", () => {
    it("Platform Admin이 아니면 forbidden", async () => {
      const result = await rejectOrganizationCreationRequest(nonAdmin as never, 100, { rejectionReason: "사유" });
      expect(result).toEqual({ kind: "forbidden" });
    });

    it("거절 사유와 함께 REJECTED로 전환", async () => {
      organizationCreationRequest.findUnique.mockResolvedValueOnce({
        id: 100,
        requestedByUserId: 5,
        organizationName: "AI 동아리",
        status: "PENDING",
      });
      organizationCreationRequest.updateMany.mockResolvedValueOnce({ count: 1 });

      const result = await rejectOrganizationCreationRequest(admin as never, 100, { rejectionReason: "정보 부족" });

      expect(result).toEqual({ kind: "ok", data: { id: 100 } });
      expect(organizationCreationRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "REJECTED", rejectionReason: "정보 부족" }) }),
      );
    });

    it("거절 시 신청자 1명에게만 알림을 생성한다", async () => {
      organizationCreationRequest.findUnique.mockResolvedValueOnce({
        id: 100,
        requestedByUserId: 5,
        organizationName: "AI 동아리",
        status: "PENDING",
      });
      organizationCreationRequest.updateMany.mockResolvedValueOnce({ count: 1 });

      await rejectOrganizationCreationRequest(admin as never, 100, { rejectionReason: "정보 부족" });

      expect(notification.create).toHaveBeenCalledTimes(1);
      expect(notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 5,
          type: "ORGANIZATION_REQUEST_PROCESSED",
          relatedType: "organization_creation_request",
          relatedId: 100,
        }),
      });
    });

    it("이미 처리된 요청을 다시 거절하면 알림도 생성하지 않는다", async () => {
      organizationCreationRequest.findUnique.mockResolvedValueOnce({
        id: 100,
        requestedByUserId: 5,
        organizationName: "AI 동아리",
        status: "REJECTED",
      });
      organizationCreationRequest.updateMany.mockResolvedValueOnce({ count: 0 });

      await rejectOrganizationCreationRequest(admin as never, 100, { rejectionReason: "정보 부족" });

      expect(notification.create).not.toHaveBeenCalled();
    });

    it("이미 처리된 요청이면 invalid_state", async () => {
      organizationCreationRequest.findUnique.mockResolvedValueOnce({ id: 100, status: "APPROVED" });
      organizationCreationRequest.updateMany.mockResolvedValueOnce({ count: 0 });
      expect(await rejectOrganizationCreationRequest(admin as never, 100, { rejectionReason: "사유" })).toEqual({
        kind: "invalid_state",
      });
    });
  });
});

describe("Join Request", () => {
  describe("createJoinRequest", () => {
    it("존재하지 않는 조직이면 not_found", async () => {
      organization.findUnique.mockResolvedValueOnce(null);
      expect(await createJoinRequest(2, 999, {})).toEqual({ kind: "not_found" });
    });

    it("비활성 조직이면 inactive_organization", async () => {
      organization.findUnique.mockResolvedValueOnce({ status: "INACTIVE" });
      expect(await createJoinRequest(2, 10, {})).toEqual({ kind: "inactive_organization" });
    });

    it("이미 멤버면 already_member", async () => {
      organization.findUnique.mockResolvedValueOnce({ status: "ACTIVE" });
      organizationMember.findUnique.mockResolvedValueOnce(memberRow());
      expect(await createJoinRequest(2, 10, {})).toEqual({ kind: "already_member" });
    });

    it("이미 PENDING 요청이 있으면 duplicate_pending_request", async () => {
      organization.findUnique.mockResolvedValueOnce({ status: "ACTIVE" });
      organizationMember.findUnique.mockResolvedValueOnce(null);
      organizationJoinRequest.findFirst.mockResolvedValueOnce({ id: 55 });
      expect(await createJoinRequest(2, 10, {})).toEqual({ kind: "duplicate_pending_request" });
      expect(organizationJoinRequest.create).not.toHaveBeenCalled();
    });

    it("정상 생성", async () => {
      organization.findUnique.mockResolvedValueOnce({ status: "ACTIVE" });
      organizationMember.findUnique.mockResolvedValueOnce(null);
      organizationJoinRequest.findFirst.mockResolvedValueOnce(null);
      organizationJoinRequest.create.mockResolvedValueOnce({ id: 55 });

      const result = await createJoinRequest(2, 10, { message: "가입하고 싶습니다" });

      expect(result).toEqual({ kind: "ok", data: { id: 55 } });
      expect(organizationJoinRequest.create).toHaveBeenCalledWith({
        data: { organizationId: 10, userId: 2, message: "가입하고 싶습니다" },
      });
    });

    // Phase 12-4 §8: pre-check를 모두 통과한 뒤에도(사전 조회 시점에는 PENDING
    // 요청이 없었지만) 진짜 동시 이중 요청이 create() 시점에 partial unique
    // index(idx_org_join_request_pending_unique)에 걸리는 경우 -- 원시 P2002가
    // 아니라 이미 pre-check 실패 경로와 동일한 duplicate_pending_request로
    // 변환되어야 한다.
    it("pre-check 통과 후 진짜 동시 요청으로 P2002가 발생하면 duplicate_pending_request로 변환", async () => {
      organization.findUnique.mockResolvedValueOnce({ status: "ACTIVE" });
      organizationMember.findUnique.mockResolvedValueOnce(null);
      organizationJoinRequest.findFirst.mockResolvedValueOnce(null);
      organizationJoinRequest.create.mockRejectedValueOnce(new FakePrismaClientKnownRequestError("P2002"));

      const result = await createJoinRequest(2, 10, {});

      expect(result).toEqual({ kind: "duplicate_pending_request" });
    });

    it("P2002가 아닌 다른 오류는 그대로 던진다", async () => {
      organization.findUnique.mockResolvedValueOnce({ status: "ACTIVE" });
      organizationMember.findUnique.mockResolvedValueOnce(null);
      organizationJoinRequest.findFirst.mockResolvedValueOnce(null);
      const unrelated = new Error("connection lost");
      organizationJoinRequest.create.mockRejectedValueOnce(unrelated);

      await expect(createJoinRequest(2, 10, {})).rejects.toThrow("connection lost");
    });
  });

  describe("cancelJoinRequest", () => {
    it("본인 요청만 취소 가능", async () => {
      organizationJoinRequest.findUnique.mockResolvedValueOnce({ id: 55, userId: 2, status: "PENDING" });
      expect(await cancelJoinRequest(999, 55)).toEqual({ kind: "forbidden" });
    });

    it("정상 취소", async () => {
      organizationJoinRequest.findUnique.mockResolvedValueOnce({ id: 55, userId: 2, status: "PENDING" });
      organizationJoinRequest.updateMany.mockResolvedValueOnce({ count: 1 });
      expect(await cancelJoinRequest(2, 55)).toEqual({ kind: "ok", data: { id: 55 } });
    });
  });

  const joinRequestRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 55,
    organizationId: 10,
    userId: 2,
    status: "PENDING",
    organization: { name: "명지대학교 총학생회" },
    ...overrides,
  });

  describe("approveJoinRequest", () => {
    it("LEADER/ADMIN이 아니면 forbidden", async () => {
      organizationJoinRequest.findUnique.mockResolvedValueOnce(joinRequestRow());
      organizationMember.findUnique.mockResolvedValueOnce(memberRow({ role: "MEMBER" })); // actor의 멤버십 조회 (canManageMembers)

      const result = await approveJoinRequest(3, 55);

      expect(result).toEqual({ kind: "forbidden" });
      expect(organizationMember.create).not.toHaveBeenCalled();
      expect(notification.create).not.toHaveBeenCalled();
    });

    it("승인 시 OrganizationMember(MEMBER) 생성 및 신청자에게 알림 발송", async () => {
      organizationJoinRequest.findUnique.mockResolvedValueOnce(joinRequestRow());
      organizationMember.findUnique
        .mockResolvedValueOnce(memberRow({ userId: 3, role: "ADMIN" })) // actor (canManageMembers)
        .mockResolvedValueOnce(null); // 트랜잭션 내 "이미 멤버인가" 재확인
      organizationJoinRequest.updateMany.mockResolvedValueOnce({ count: 1 });

      const result = await approveJoinRequest(3, 55);

      expect(result).toEqual({ kind: "ok", data: { id: 55 } });
      expect(organizationMember.create).toHaveBeenCalledWith({
        data: { organizationId: 10, userId: 2, role: "MEMBER" },
      });
      // Phase 12-4 §28: 가입 신청자(userId: 2) 1명에게만, 기존
      // ORGANIZATION_REQUEST_PROCESSED 타입 재사용, relatedType은 조직 자체.
      expect(notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 2,
          type: "ORGANIZATION_REQUEST_PROCESSED",
          relatedType: "organization",
          relatedId: 10,
        }),
      });
    });

    it("동시 이중 승인 방어 -- 알림도 발송되지 않는다", async () => {
      organizationJoinRequest.findUnique.mockResolvedValueOnce(joinRequestRow());
      organizationMember.findUnique.mockResolvedValueOnce(memberRow({ userId: 3, role: "LEADER" }));
      organizationJoinRequest.updateMany.mockResolvedValueOnce({ count: 0 });

      expect(await approveJoinRequest(3, 55)).toEqual({ kind: "invalid_state" });
      expect(organizationMember.create).not.toHaveBeenCalled();
      expect(notification.create).not.toHaveBeenCalled();
    });
  });

  describe("rejectJoinRequest", () => {
    it("LEADER/ADMIN이 아니면 forbidden", async () => {
      organizationJoinRequest.findUnique.mockResolvedValueOnce(joinRequestRow());
      organizationMember.findUnique.mockResolvedValueOnce(memberRow({ role: "MEMBER" }));
      expect(await rejectJoinRequest(3, 55, {})).toEqual({ kind: "forbidden" });
      expect(notification.create).not.toHaveBeenCalled();
    });

    it("정상 거절 및 신청자에게 알림 발송", async () => {
      organizationJoinRequest.findUnique.mockResolvedValueOnce(joinRequestRow());
      organizationMember.findUnique.mockResolvedValueOnce(memberRow({ role: "LEADER" }));
      organizationJoinRequest.updateMany.mockResolvedValueOnce({ count: 1 });
      expect(await rejectJoinRequest(3, 55, { rejectionReason: "정원 초과" })).toEqual({ kind: "ok", data: { id: 55 } });
      expect(notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 2,
          type: "ORGANIZATION_REQUEST_PROCESSED",
          relatedType: "organization",
          relatedId: 10,
        }),
      });
    });

    it("동시 이중 거절 방어 -- 알림도 발송되지 않는다", async () => {
      organizationJoinRequest.findUnique.mockResolvedValueOnce(joinRequestRow());
      organizationMember.findUnique.mockResolvedValueOnce(memberRow({ role: "LEADER" }));
      organizationJoinRequest.updateMany.mockResolvedValueOnce({ count: 0 });
      expect(await rejectJoinRequest(3, 55, {})).toEqual({ kind: "invalid_state" });
      expect(notification.create).not.toHaveBeenCalled();
    });
  });
});

describe("구성원 관리", () => {
  describe("appointAdmin (LEADER 전용, target은 MEMBER여야 함)", () => {
    it("LEADER가 아니면 forbidden", async () => {
      organizationMember.findUnique.mockResolvedValueOnce(memberRow({ role: "ADMIN" })); // canAppointAdmin의 actor 조회
      expect(await appointAdmin(3, 10, 2)).toEqual({ kind: "forbidden" });
    });

    it("target이 구성원이 아니면 target_not_active_member", async () => {
      organizationMember.findUnique
        .mockResolvedValueOnce(memberRow({ role: "LEADER" }))
        .mockResolvedValueOnce(null);
      expect(await appointAdmin(1, 10, 999)).toEqual({ kind: "target_not_active_member" });
    });

    it("target이 이미 ADMIN/LEADER면 invalid_state", async () => {
      organizationMember.findUnique
        .mockResolvedValueOnce(memberRow({ role: "LEADER" }))
        .mockResolvedValueOnce(memberRow({ role: "ADMIN" }));
      expect(await appointAdmin(1, 10, 2)).toEqual({ kind: "invalid_state" });
    });

    it("정상 임명", async () => {
      organizationMember.findUnique
        .mockResolvedValueOnce(memberRow({ role: "LEADER" }))
        .mockResolvedValueOnce(memberRow({ role: "MEMBER" }));
      organizationMember.update.mockResolvedValueOnce(memberRow({ role: "ADMIN" }));

      const result = await appointAdmin(1, 10, 2);

      expect(result.kind).toBe("ok");
      if (result.kind === "ok") expect(result.data.role).toBe("admin");
    });
  });

  describe("removeAdmin (LEADER 전용, target은 ADMIN이어야 함)", () => {
    it("LEADER가 아니면 forbidden", async () => {
      organizationMember.findUnique.mockResolvedValueOnce(memberRow({ role: "MEMBER" }));
      expect(await removeAdmin(3, 10, 2)).toEqual({ kind: "forbidden" });
    });

    it("정상 해임 (ADMIN -> MEMBER)", async () => {
      organizationMember.findUnique
        .mockResolvedValueOnce(memberRow({ role: "LEADER" }))
        .mockResolvedValueOnce(memberRow({ role: "ADMIN" }));
      organizationMember.update.mockResolvedValueOnce(memberRow({ role: "MEMBER" }));

      const result = await removeAdmin(1, 10, 2);

      expect(result.kind).toBe("ok");
      if (result.kind === "ok") expect(result.data.role).toBe("member");
    });
  });

  describe("removeMember (강제 제거)", () => {
    it("권한 없으면 forbidden", async () => {
      organizationMember.findUnique
        .mockResolvedValueOnce(memberRow({ role: "MEMBER" })) // actor
        .mockResolvedValueOnce(memberRow({ role: "MEMBER" })); // target
      expect(await removeMember(3, 10, 2)).toEqual({ kind: "forbidden" });
      expect(organizationMember.delete).not.toHaveBeenCalled();
    });

    it("ADMIN이 MEMBER를 정상 제거", async () => {
      organizationMember.findUnique
        .mockResolvedValueOnce(memberRow({ role: "ADMIN" })) // actor (canRemoveMember)
        .mockResolvedValueOnce(memberRow({ role: "MEMBER" })) // target (canRemoveMember)
        .mockResolvedValueOnce(memberRow({ role: "MEMBER" })); // 실제 삭제 대상 재조회
      expect(await removeMember(3, 10, 2)).toEqual({ kind: "ok", data: { id: 2 } });
      expect(organizationMember.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });
  });
});

describe("leaveOrganization (자발적 탈퇴 + 마지막 LEADER 보호)", () => {
  it("구성원이 아니면 not_a_member", async () => {
    organizationMember.findUnique.mockResolvedValueOnce(null);
    expect(await leaveOrganization(2, 10)).toEqual({ kind: "not_a_member" });
  });

  it("일반 MEMBER 탈퇴는 항상 성공", async () => {
    organizationMember.findUnique.mockResolvedValueOnce(memberRow({ role: "MEMBER" }));
    const result = await leaveOrganization(2, 10);
    expect(result).toEqual({ kind: "ok", data: { id: 2 } });
    expect(organizationMember.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it("ADMIN 탈퇴도 항상 성공 (LEADER가 아니므로 마지막 LEADER 체크 대상 아님)", async () => {
    organizationMember.findUnique.mockResolvedValueOnce(memberRow({ role: "ADMIN" }));
    const result = await leaveOrganization(2, 10);
    expect(result).toEqual({ kind: "ok", data: { id: 2 } });
  });

  it("LEADER가 유일하면 탈퇴 차단 -- last_leader_cannot_leave", async () => {
    organizationMember.findUnique.mockResolvedValueOnce(memberRow({ role: "LEADER" }));
    organizationMember.count.mockResolvedValueOnce(1);

    const result = await leaveOrganization(2, 10);

    expect(result).toEqual({ kind: "last_leader_cannot_leave" });
    expect(organizationMember.delete).not.toHaveBeenCalled();
  });

  it("LEADER가 여러 명이면 그 중 한 명의 탈퇴는 허용", async () => {
    organizationMember.findUnique.mockResolvedValueOnce(memberRow({ role: "LEADER" }));
    organizationMember.count.mockResolvedValueOnce(2);

    const result = await leaveOrganization(2, 10);

    expect(result).toEqual({ kind: "ok", data: { id: 2 } });
  });

  // §20: 동시성 -- 이 phase의 테스트 환경은 실제 두 개의 동시 커넥션을
  // 만들 수 없으므로(단일 mock 프로세스), 실제로 검증하는 것은 "행 잠금이
  // 삭제보다 먼저 걸린다"는 순서 그 자체다. 진짜 동시 두 트랜잭션 간의
  // 잠금 대기는 Prisma/mock 레벨에서 재현 불가능하다는 한계는 최종
  // 보고서에 명시한다.
  it("LEADER 행에 대한 SELECT ... FOR UPDATE 잠금을 멤버십 조회보다 먼저 시도한다", async () => {
    organizationMember.findUnique.mockResolvedValueOnce(memberRow({ role: "MEMBER" }));

    await leaveOrganization(2, 10);

    const lockOrder = queryRaw.mock.invocationCallOrder[0];
    const findOrder = organizationMember.findUnique.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(findOrder);
  });
});

describe("transferLeadership", () => {
  it("본인에게 승계할 수 없음", async () => {
    expect(await transferLeadership(10, 1, 1)).toEqual({ kind: "invalid_state" });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("현재 사용자가 LEADER가 아니면 forbidden", async () => {
    organizationMember.findUnique.mockResolvedValueOnce(memberRow({ userId: 1, role: "ADMIN" }));
    expect(await transferLeadership(10, 1, 2)).toEqual({ kind: "forbidden" });
  });

  it("target이 구성원이 아니면 target_not_active_member", async () => {
    organizationMember.findUnique
      .mockResolvedValueOnce(memberRow({ userId: 1, role: "LEADER" }))
      .mockResolvedValueOnce(null);
    expect(await transferLeadership(10, 1, 999)).toEqual({ kind: "target_not_active_member" });
  });

  it("target -> LEADER, 기존 LEADER -> ADMIN 원자적 전환", async () => {
    organizationMember.findUnique
      .mockResolvedValueOnce(memberRow({ id: 1, userId: 1, role: "LEADER" }))
      .mockResolvedValueOnce(memberRow({ id: 2, userId: 2, role: "MEMBER" }));

    const result = await transferLeadership(10, 1, 2);

    expect(result).toEqual({ kind: "ok", data: { id: 2 } });
    expect(organizationMember.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { role: "LEADER" } });
    expect(organizationMember.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { role: "ADMIN" } });
  });
});

describe("deactivateOrganization", () => {
  it("권한 없으면 forbidden", async () => {
    organizationMember.findUnique.mockResolvedValueOnce(memberRow({ role: "ADMIN" }));
    expect(await deactivateOrganization(2, 10, false)).toEqual({ kind: "forbidden" });
    expect(organization.updateMany).not.toHaveBeenCalled();
  });

  it("LEADER는 자기 조직을 비활성화할 수 있다", async () => {
    organizationMember.findUnique.mockResolvedValueOnce(memberRow({ role: "LEADER" }));
    organization.updateMany.mockResolvedValueOnce({ count: 1 });
    expect(await deactivateOrganization(2, 10, false)).toEqual({ kind: "ok", data: { id: 10 } });
  });

  it("Platform Admin override -- 멤버가 아니어도 비활성화 가능", async () => {
    organization.updateMany.mockResolvedValueOnce({ count: 1 });
    const result = await deactivateOrganization(99, 10, true);
    expect(result).toEqual({ kind: "ok", data: { id: 10 } });
    expect(organizationMember.findUnique).not.toHaveBeenCalled();
  });

  it("이미 비활성화된 조직이면 invalid_state", async () => {
    organizationMember.findUnique.mockResolvedValueOnce(memberRow({ role: "LEADER" }));
    organization.updateMany.mockResolvedValueOnce({ count: 0 });
    organization.findUnique.mockResolvedValueOnce({ id: 10 });
    expect(await deactivateOrganization(2, 10, false)).toEqual({ kind: "invalid_state" });
  });

  it("존재하지 않는 조직이면 not_found", async () => {
    organizationMember.findUnique.mockResolvedValueOnce(memberRow({ role: "LEADER" }));
    organization.updateMany.mockResolvedValueOnce({ count: 0 });
    organization.findUnique.mockResolvedValueOnce(null);
    expect(await deactivateOrganization(2, 10, false)).toEqual({ kind: "not_found" });
  });
});

// Phase 12-6: Platform Admin 전용 함수들 -- 매 함수가 자신만의
// isAdmin(admin) 게이트를 갖는다(다른 admin 전용 함수들과 동일한 관례).
describe("listOrganizationsForAdmin (Phase 12-6)", () => {
  it("Platform Admin이 아니면 forbidden", async () => {
    expect(await listOrganizationsForAdmin(nonAdmin as never, { page: 1, limit: 20 })).toEqual({ kind: "forbidden" });
    expect(organization.findMany).not.toHaveBeenCalled();
  });

  it("memberCount와 leader를 하나의 쿼리 결과에서 함께 반환한다 (N+1 없음)", async () => {
    organization.findMany.mockResolvedValueOnce([
      {
        ...orgRow(),
        _count: { members: 5 },
        members: [{ user: { id: 3, nickname: "리더", publicId: "pub-3" } }],
      },
    ]);
    organization.count.mockResolvedValueOnce(1);

    const result = await listOrganizationsForAdmin(admin as never, { page: 1, limit: 20 });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.items[0]).toEqual(
        expect.objectContaining({ memberCount: 5, leader: { id: 3, nickname: "리더", publicId: "pub-3" } }),
      );
    }
    // 목록 조회 한 번에 findMany 한 번만 -- 항목별 추가 쿼리 없음.
    expect(organization.findMany).toHaveBeenCalledTimes(1);
  });

  it("리더가 없는 조직(레이스 등 예외 상황)은 leader: null", async () => {
    organization.findMany.mockResolvedValueOnce([{ ...orgRow(), _count: { members: 0 }, members: [] }]);
    organization.count.mockResolvedValueOnce(1);

    const result = await listOrganizationsForAdmin(admin as never, { page: 1, limit: 20 });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.items[0].leader).toBeNull();
  });

  it("status 필터를 적용한다", async () => {
    organization.findMany.mockResolvedValueOnce([]);
    organization.count.mockResolvedValueOnce(0);

    await listOrganizationsForAdmin(admin as never, { status: "inactive", page: 1, limit: 20 });

    expect(organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "INACTIVE" }) }),
    );
  });

  it("status 생략 시 전체 조직을 조회한다 (ACTIVE만이 아님)", async () => {
    organization.findMany.mockResolvedValueOnce([]);
    organization.count.mockResolvedValueOnce(0);

    await listOrganizationsForAdmin(admin as never, { page: 1, limit: 20 });

    const callArgs = organization.findMany.mock.calls[0][0];
    expect(callArgs.where).not.toHaveProperty("status");
  });

  it("이름 검색(q)을 적용한다", async () => {
    organization.findMany.mockResolvedValueOnce([]);
    organization.count.mockResolvedValueOnce(0);

    await listOrganizationsForAdmin(admin as never, { q: "도서관", page: 1, limit: 20 });

    expect(organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ name: { contains: "도서관", mode: "insensitive" } }) }),
    );
  });
});

describe("getOrganizationForAdmin (Phase 12-6)", () => {
  it("Platform Admin이 아니면 forbidden", async () => {
    expect(await getOrganizationForAdmin(nonAdmin as never, 10)).toEqual({ kind: "forbidden" });
    expect(organization.findUnique).not.toHaveBeenCalled();
  });

  it("존재하지 않는 조직이면 not_found", async () => {
    organization.findUnique.mockResolvedValueOnce(null);
    expect(await getOrganizationForAdmin(admin as never, 999)).toEqual({ kind: "not_found" });
  });

  it("조직 정보 + 구성원 목록을 함께 반환한다", async () => {
    organization.findUnique.mockResolvedValueOnce(orgRow());
    organizationMember.findMany.mockResolvedValueOnce([memberRow({ role: "LEADER" })]);

    const result = await getOrganizationForAdmin(admin as never, 10);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.id).toBe(10);
      expect(result.data.members).toHaveLength(1);
      expect(result.data.members[0].role).toBe("leader");
    }
  });
});

describe("setOrganizationStatusForAdmin (Phase 12-6)", () => {
  it("Platform Admin이 아니면 forbidden", async () => {
    expect(await setOrganizationStatusForAdmin(nonAdmin as never, 10, "inactive")).toEqual({ kind: "forbidden" });
    expect(organization.updateMany).not.toHaveBeenCalled();
  });

  it("ACTIVE -> INACTIVE 성공", async () => {
    organization.updateMany.mockResolvedValueOnce({ count: 1 });
    const result = await setOrganizationStatusForAdmin(admin as never, 10, "inactive");
    expect(result).toEqual({ kind: "ok", data: { id: 10 } });
    expect(organization.updateMany).toHaveBeenCalledWith({
      where: { id: 10, status: "ACTIVE" },
      data: { status: "INACTIVE" },
    });
  });

  it("INACTIVE -> ACTIVE 성공 (Phase 12-4가 남긴 재활성화 gap 해소)", async () => {
    organization.updateMany.mockResolvedValueOnce({ count: 1 });
    const result = await setOrganizationStatusForAdmin(admin as never, 10, "active");
    expect(result).toEqual({ kind: "ok", data: { id: 10 } });
    expect(organization.updateMany).toHaveBeenCalledWith({
      where: { id: 10, status: "INACTIVE" },
      data: { status: "ACTIVE" },
    });
  });

  it("존재하지 않는 조직이면 not_found", async () => {
    organization.updateMany.mockResolvedValueOnce({ count: 0 });
    organization.findUnique.mockResolvedValueOnce(null);
    expect(await setOrganizationStatusForAdmin(admin as never, 999, "inactive")).toEqual({ kind: "not_found" });
  });

  it("이미 INACTIVE인데 INACTIVE 요청 -> invalid_state", async () => {
    organization.updateMany.mockResolvedValueOnce({ count: 0 });
    organization.findUnique.mockResolvedValueOnce({ id: 10 });
    expect(await setOrganizationStatusForAdmin(admin as never, 10, "inactive")).toEqual({ kind: "invalid_state" });
  });

  it("이미 ACTIVE인데 ACTIVE 요청 -> invalid_state", async () => {
    organization.updateMany.mockResolvedValueOnce({ count: 0 });
    organization.findUnique.mockResolvedValueOnce({ id: 10 });
    expect(await setOrganizationStatusForAdmin(admin as never, 10, "active")).toEqual({ kind: "invalid_state" });
  });

  // §23: 동시에 두 관리자가 같은 방향으로 전환을 시도해도(둘 다 ACTIVE ->
  // INACTIVE), 조건부 updateMany 자체가 원자적이므로 두 번째 호출은 count: 0
  // 을 받아 invalid_state로 안전하게 처리된다 -- 별도 트랜잭션/잠금 없이도
  // 데이터가 깨지지 않는다.
  it("동시 상태 변경 -- 두 번째 호출은 조건부 update가 0건이라 invalid_state", async () => {
    organization.updateMany.mockResolvedValueOnce({ count: 1 }); // Admin A
    const first = await setOrganizationStatusForAdmin(admin as never, 10, "inactive");
    expect(first).toEqual({ kind: "ok", data: { id: 10 } });

    organization.updateMany.mockResolvedValueOnce({ count: 0 }); // Admin B, 이미 INACTIVE
    organization.findUnique.mockResolvedValueOnce({ id: 10 });
    const second = await setOrganizationStatusForAdmin(admin as never, 10, "inactive");
    expect(second).toEqual({ kind: "invalid_state" });
  });
});

// Phase 12-7 §2/§5: "단체 관리자 다중화" + "여러 단체 가입" -- both already
// work by construction in the existing LEADER/ADMIN/MEMBER model (an
// unbounded number of ADMIN rows per org was never restricted, and
// OrganizationMember's own unique(organizationId, userId) constraint only
// ever blocks a duplicate row for the *same* org). These tests lock that
// in explicitly rather than leaving it merely implied by other tests'
// incidental fixture shapes.
describe("Phase 12-7: 단체 관리자 다중화 / 여러 단체 동시 가입", () => {
  it("한 단체에 여러 명의 관리자(ADMIN)를 동시에 둘 수 있다 -- 서로 다른 MEMBER를 독립적으로 임명", async () => {
    // 첫 번째 임명: MEMBER(userId=2) -> ADMIN
    organizationMember.findUnique
      .mockResolvedValueOnce(memberRow({ role: "LEADER" })) // actor
      .mockResolvedValueOnce(memberRow({ userId: 2, role: "MEMBER" })); // target
    organizationMember.update.mockResolvedValueOnce(memberRow({ userId: 2, role: "ADMIN" }));
    const first = await appointAdmin(1, 10, 2);
    expect(first).toEqual({ kind: "ok", data: expect.objectContaining({ role: "admin" }) });

    // 두 번째 임명: 다른 MEMBER(userId=3) -> ADMIN -- 이미 ADMIN이 존재하는 것과
    // 무관하게 독립적으로 성공해야 한다(단일 ADMIN 제한이 없음을 확인).
    organizationMember.findUnique
      .mockResolvedValueOnce(memberRow({ role: "LEADER" })) // actor
      .mockResolvedValueOnce(memberRow({ userId: 3, role: "MEMBER" })); // target
    organizationMember.update.mockResolvedValueOnce(memberRow({ userId: 3, role: "ADMIN" }));
    const second = await appointAdmin(1, 10, 3);
    expect(second).toEqual({ kind: "ok", data: expect.objectContaining({ role: "admin" }) });
  });

  it("구성원 목록 조회 시 여러 명의 ADMIN이 함께 반환된다", async () => {
    organizationMember.findMany.mockResolvedValueOnce([
      memberRow({ id: 1, userId: 1, role: "LEADER" }),
      memberRow({ id: 2, userId: 2, role: "ADMIN" }),
      memberRow({ id: 3, userId: 3, role: "ADMIN" }),
      memberRow({ id: 4, userId: 4, role: "MEMBER" }),
    ]);

    const members = await getOrganizationMembers(10);

    const admins = members.filter((m) => m.role === "admin");
    expect(admins).toHaveLength(2);
  });

  it("한 사용자가 여러 단체에 서로 다른 역할로 동시에 가입할 수 있다", async () => {
    organizationMember.findMany.mockResolvedValueOnce([
      { role: "ADMIN", organization: { id: 10, name: "총학생회", status: "ACTIVE" } },
      { role: "MEMBER", organization: { id: 20, name: "AI 동아리", status: "ACTIVE" } },
      { role: "LEADER", organization: { id: 30, name: "학과 학생회", status: "ACTIVE" } },
    ]);

    const memberships = await getMyOrganizationMemberships(7);

    expect(memberships).toEqual([
      { organizationId: 10, organizationName: "총학생회", organizationStatus: "active", role: "admin" },
      { organizationId: 20, organizationName: "AI 동아리", organizationStatus: "active", role: "member" },
      { organizationId: 30, organizationName: "학과 학생회", organizationStatus: "active", role: "leader" },
    ]);
  });

  it("동일 단체 중복 가입은 여전히 already_member로 차단된다 (unique 제약은 유지)", async () => {
    organization.findUnique.mockResolvedValueOnce({ status: "ACTIVE" });
    organizationMember.findUnique.mockResolvedValueOnce(memberRow({ role: "MEMBER" }));
    expect(await createJoinRequest(2, 10, {})).toEqual({ kind: "already_member" });
  });
});
