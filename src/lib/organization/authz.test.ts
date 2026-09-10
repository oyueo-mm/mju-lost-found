import { beforeEach, describe, expect, it, vi } from "vitest";

const organizationMemberFindUnique = vi.fn();
const organizationFindUnique = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: { organizationMember: { findUnique: organizationMemberFindUnique }, organization: { findUnique: organizationFindUnique } },
}));
vi.mock("@/generated/prisma/client", () => ({
  OrganizationRole: { LEADER: "LEADER", ADMIN: "ADMIN", MEMBER: "MEMBER" },
  OrganizationStatus: { ACTIVE: "ACTIVE", INACTIVE: "INACTIVE" },
}));

const {
  canManageOrganization,
  canPostAsOrganization,
  canManageMembers,
  canAppointAdmin,
  canRemoveMember,
  canTransferLeadership,
  canDeactivateOrganization,
} = await import("./authz");

const membership = (role: "LEADER" | "ADMIN" | "MEMBER") => ({ id: 1, organizationId: 1, userId: 1, role });

beforeEach(() => {
  vi.clearAllMocks();
});

// Phase 12-4: widened from LEADER-only to ADMIN 이상 (§10/§11의 명시적
// 요구 -- ADMIN도 "조직 기본 정보 수정" 가능) -- see authz.ts's own updated
// comment on canManageOrganization for why this doesn't affect any other
// permission (join request review is canManageMembers, deactivation is
// canDeactivateOrganization, both unchanged and tested separately below).
describe("canManageOrganization (조직 기본 정보 수정 -- ADMIN 이상)", () => {
  it("LEADER: true", async () => {
    organizationMemberFindUnique.mockResolvedValueOnce(membership("LEADER"));
    expect(await canManageOrganization(1, 1)).toBe(true);
  });
  it("ADMIN: true", async () => {
    organizationMemberFindUnique.mockResolvedValueOnce(membership("ADMIN"));
    expect(await canManageOrganization(1, 1)).toBe(true);
  });
  it("MEMBER: false", async () => {
    organizationMemberFindUnique.mockResolvedValueOnce(membership("MEMBER"));
    expect(await canManageOrganization(1, 1)).toBe(false);
  });
  it("non-member: false", async () => {
    organizationMemberFindUnique.mockResolvedValueOnce(null);
    expect(await canManageOrganization(1, 1)).toBe(false);
  });
});

describe("canPostAsOrganization (조직 명의 활동 -- 모든 role 가능, 단 ACTIVE 조직만)", () => {
  it("LEADER of an ACTIVE organization: true", async () => {
    organizationFindUnique.mockResolvedValueOnce({ status: "ACTIVE" });
    organizationMemberFindUnique.mockResolvedValueOnce(membership("LEADER"));
    expect(await canPostAsOrganization(1, 1)).toBe(true);
  });
  it("ADMIN of an ACTIVE organization: true", async () => {
    organizationFindUnique.mockResolvedValueOnce({ status: "ACTIVE" });
    organizationMemberFindUnique.mockResolvedValueOnce(membership("ADMIN"));
    expect(await canPostAsOrganization(1, 1)).toBe(true);
  });
  it("MEMBER of an ACTIVE organization: true", async () => {
    organizationFindUnique.mockResolvedValueOnce({ status: "ACTIVE" });
    organizationMemberFindUnique.mockResolvedValueOnce(membership("MEMBER"));
    expect(await canPostAsOrganization(1, 1)).toBe(true);
  });
  it("non-member: false", async () => {
    organizationFindUnique.mockResolvedValueOnce({ status: "ACTIVE" });
    organizationMemberFindUnique.mockResolvedValueOnce(null);
    expect(await canPostAsOrganization(1, 1)).toBe(false);
  });
  it("blocks every role for an INACTIVE organization -- short-circuits before even querying membership", async () => {
    organizationFindUnique.mockResolvedValueOnce({ status: "INACTIVE" });
    expect(await canPostAsOrganization(1, 1)).toBe(false);
    expect(organizationMemberFindUnique).not.toHaveBeenCalled(); // 조직 상태부터 확인, 불필요한 조회 없음
  });
  it("nonexistent organization: false", async () => {
    organizationFindUnique.mockResolvedValueOnce(null);
    expect(await canPostAsOrganization(1, 999)).toBe(false);
  });
});

describe("canManageMembers (가입 요청 승인/거절, MEMBER 강제 탈퇴 -- ADMIN 이상)", () => {
  it("LEADER: true", async () => {
    organizationMemberFindUnique.mockResolvedValueOnce(membership("LEADER"));
    expect(await canManageMembers(1, 1)).toBe(true);
  });
  it("ADMIN: true", async () => {
    organizationMemberFindUnique.mockResolvedValueOnce(membership("ADMIN"));
    expect(await canManageMembers(1, 1)).toBe(true);
  });
  it("MEMBER: false", async () => {
    organizationMemberFindUnique.mockResolvedValueOnce(membership("MEMBER"));
    expect(await canManageMembers(1, 1)).toBe(false);
  });
  it("non-member: false", async () => {
    organizationMemberFindUnique.mockResolvedValueOnce(null);
    expect(await canManageMembers(1, 1)).toBe(false);
  });
});

describe("canAppointAdmin (ADMIN 임명/해임 -- LEADER 전용, ADMIN이 다른 ADMIN을 임명할 수 없음)", () => {
  it("LEADER: true", async () => {
    organizationMemberFindUnique.mockResolvedValueOnce(membership("LEADER"));
    expect(await canAppointAdmin(1, 1)).toBe(true);
  });
  it("ADMIN: false", async () => {
    organizationMemberFindUnique.mockResolvedValueOnce(membership("ADMIN"));
    expect(await canAppointAdmin(1, 1)).toBe(false);
  });
  it("MEMBER: false", async () => {
    organizationMemberFindUnique.mockResolvedValueOnce(membership("MEMBER"));
    expect(await canAppointAdmin(1, 1)).toBe(false);
  });
});

describe("canRemoveMember (강제 제거 -- actor/target role 조합에 따라 다름)", () => {
  it("LEADER actor, target MEMBER: true", async () => {
    organizationMemberFindUnique.mockResolvedValueOnce(membership("LEADER")).mockResolvedValueOnce(membership("MEMBER"));
    expect(await canRemoveMember(1, 1, 2)).toBe(true);
  });
  it("LEADER actor, target ADMIN: true", async () => {
    organizationMemberFindUnique.mockResolvedValueOnce(membership("LEADER")).mockResolvedValueOnce(membership("ADMIN"));
    expect(await canRemoveMember(1, 1, 2)).toBe(true);
  });
  it("LEADER actor, target LEADER: false -- LEADER는 이 경로로 절대 제거되지 않음 (transferLeadership 필요)", async () => {
    organizationMemberFindUnique.mockResolvedValueOnce(membership("LEADER")).mockResolvedValueOnce(membership("LEADER"));
    expect(await canRemoveMember(1, 1, 2)).toBe(false);
  });
  it("ADMIN actor, target MEMBER: true", async () => {
    organizationMemberFindUnique.mockResolvedValueOnce(membership("ADMIN")).mockResolvedValueOnce(membership("MEMBER"));
    expect(await canRemoveMember(1, 1, 2)).toBe(true);
  });
  it("ADMIN actor, target ADMIN: false -- ADMIN이 다른 ADMIN을 제거할 수 없음", async () => {
    organizationMemberFindUnique.mockResolvedValueOnce(membership("ADMIN")).mockResolvedValueOnce(membership("ADMIN"));
    expect(await canRemoveMember(1, 1, 2)).toBe(false);
  });
  it("MEMBER actor, target MEMBER: false -- MEMBER는 아무도 강제 제거할 수 없음", async () => {
    organizationMemberFindUnique.mockResolvedValueOnce(membership("MEMBER")).mockResolvedValueOnce(membership("MEMBER"));
    expect(await canRemoveMember(1, 1, 2)).toBe(false);
  });
  it("target이 이미 구성원이 아니면: false", async () => {
    organizationMemberFindUnique.mockResolvedValueOnce(membership("LEADER")).mockResolvedValueOnce(null);
    expect(await canRemoveMember(1, 1, 2)).toBe(false);
  });
  it("non-member actor: false regardless of target", async () => {
    organizationMemberFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(membership("MEMBER"));
    expect(await canRemoveMember(1, 1, 2)).toBe(false);
  });
});

describe("canTransferLeadership (LEADER 승계 개시 -- 현재 LEADER 본인만)", () => {
  it("LEADER: true", async () => {
    organizationMemberFindUnique.mockResolvedValueOnce(membership("LEADER"));
    expect(await canTransferLeadership(1, 1)).toBe(true);
  });
  it("ADMIN: false", async () => {
    organizationMemberFindUnique.mockResolvedValueOnce(membership("ADMIN"));
    expect(await canTransferLeadership(1, 1)).toBe(false);
  });
  it("MEMBER: false", async () => {
    organizationMemberFindUnique.mockResolvedValueOnce(membership("MEMBER"));
    expect(await canTransferLeadership(1, 1)).toBe(false);
  });
});

describe("canDeactivateOrganization (조직 비활성화 -- LEADER 또는 Platform Admin override)", () => {
  it("LEADER, not a platform admin: true", async () => {
    organizationMemberFindUnique.mockResolvedValueOnce(membership("LEADER"));
    expect(await canDeactivateOrganization(1, 1, false)).toBe(true);
  });
  it("ADMIN, not a platform admin: false", async () => {
    organizationMemberFindUnique.mockResolvedValueOnce(membership("ADMIN"));
    expect(await canDeactivateOrganization(1, 1, false)).toBe(false);
  });
  it("MEMBER, not a platform admin: false", async () => {
    organizationMemberFindUnique.mockResolvedValueOnce(membership("MEMBER"));
    expect(await canDeactivateOrganization(1, 1, false)).toBe(false);
  });
  it("non-member, not a platform admin: false", async () => {
    organizationMemberFindUnique.mockResolvedValueOnce(null);
    expect(await canDeactivateOrganization(1, 1, false)).toBe(false);
  });
  // Platform Admin은 조직의 MEMBER/ADMIN/LEADER role을 자동으로 갖지
  // 않는다는 원칙(Phase 12-1 §3) -- 그럼에도 조직 비활성화만은 명시적으로
  // 허용된 override라는 것을 isPlatformAdmin=true가 멤버십 조회 자체를
  // 건너뛰고 true를 반환하는 것으로 검증한다.
  it("platform admin override: true, without even querying membership", async () => {
    const result = await canDeactivateOrganization(1, 1, true);
    expect(result).toBe(true);
    expect(organizationMemberFindUnique).not.toHaveBeenCalled();
  });
});
