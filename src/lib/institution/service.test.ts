import { beforeEach, describe, expect, it, vi } from "vitest";

const user = vi.fn(), grants = vi.fn(), deleteMany = vi.fn(), createMany = vi.fn(), grantCount = vi.fn();
const officer = vi.fn(), upsert = vi.fn(), officerUpdate = vi.fn(), organization = vi.fn(), audit = vi.fn(), postCount = vi.fn();
const tx = {
  user: { findUnique: user },
  adminPermissionGrant: { findMany: grants, deleteMany, createMany, count: grantCount },
  institutionOfficer: { findUnique: officer, upsert, update: officerUpdate },
  organization: { findUnique: organization, create: vi.fn(), update: vi.fn() },
  institutionOfficerAudit: { create: audit },
  foundPost: { count: postCount },
  $queryRaw: vi.fn(),
};
vi.mock("@/lib/db/prisma", () => ({ prisma: { ...tx, $transaction: (fn: (db: typeof tx) => unknown) => fn(tx) } }));
const { setAdminPermissions, officerScope, saveInstitution } = await import("./service");

const ACTIVE_ORG = { id: 10, name: "본관 경비실", status: "ACTIVE", managementCampus: "양쪽" };
const accounts: Record<number, object> = {
  1: { id: 1, isAdmin: true },
  2: { id: 2, isAdmin: false },
  3: { id: 3, isAdmin: false },
  4: { id: 4, isAdmin: true },
};
let held: string[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  held = [];
  user.mockImplementation(async ({ where }: { where: { id: number } }) => accounts[where.id] ?? null);
  grants.mockImplementation(async () => held.map((permission) => ({ permission })));
  organization.mockResolvedValue(ACTIVE_ORG);
  officer.mockResolvedValue(null);
  grantCount.mockResolvedValue(0); postCount.mockResolvedValue(0);
  upsert.mockImplementation(async ({ create }: { create: object }) => ({ ...create, active: true }));
  officerUpdate.mockResolvedValue({ active: false });
});
const change = (more: object = {}) => ({ userId: 2, permissions: ["reports.view", "reports.process"], ...more });

describe("관리 권한 부여·변경·회수", () => {
  it("lets a full administrator grant permissions, with an audit row and the required view permission", async () => {
    const result = await setAdminPermissions(1, change({ permissions: ["reports.process"], reason: "신고 담당" }));
    expect(result).toMatchObject({ ok: true, unchanged: false, added: ["신고 조회", "신고 처리"], removed: [] });
    expect(createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ userId: 2, permission: "reports.view", grantedByUserId: 1 }), expect.objectContaining({ permission: "reports.process" })], skipDuplicates: true });
    expect(audit).toHaveBeenCalledWith({ data: expect.objectContaining({ actorUserId: 1, targetUserId: 2, action: "permissions_grant", reason: "신고 담당" }) });
  });

  it("refuses everyone who is not a full administrator -- including someone holding other permissions", async () => {
    held = ["users.view", "users.sanction", "institutions.manage", "access.external"];
    expect(await setAdminPermissions(3, change())).toEqual({ error: "전체 관리자만 관리 권한을 설정할 수 있습니다." });
    expect(await setAdminPermissions(99, change())).toHaveProperty("error");
    expect(createMany).not.toHaveBeenCalled(); expect(audit).not.toHaveBeenCalled();
  });

  it("never stores 권한 관리 or unknown identifiers, so it cannot be delegated", async () => {
    expect(await setAdminPermissions(1, change({ permissions: ["permissions.manage"] }))).toEqual({ error: "부여할 수 없는 권한이 포함되어 있습니다." });
    expect(await setAdminPermissions(1, change({ permissions: ["admin"] }))).toHaveProperty("error");
    expect(await setAdminPermissions(1, { ...change(), isAdmin: true })).toHaveProperty("error");
    expect(createMany).not.toHaveBeenCalled();
  });

  it("blocks changing your own permissions and a full administrator's", async () => {
    expect(await setAdminPermissions(1, change({ userId: 1 }))).toEqual({ error: "본인의 관리 권한은 직접 변경할 수 없습니다." });
    expect(await setAdminPermissions(1, change({ userId: 4 }))).toHaveProperty("error");
    expect(createMany).not.toHaveBeenCalled(); expect(deleteMany).not.toHaveBeenCalled();
  });

  it("adds and removes individual permissions and records before/after", async () => {
    held = ["reports.view", "users.view"];
    const result = await setAdminPermissions(1, change({ permissions: ["reports.view", "posts.manage"] }));
    expect(result).toMatchObject({ ok: true, added: ["게시글 관리"], removed: ["사용자 조회"] });
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 2, permission: { in: ["users.view"] } } });
    expect(audit).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "permissions_update", before: expect.objectContaining({ permissions: ["reports.view", "users.view"] }), after: expect.objectContaining({ permissions: ["posts.manage", "reports.view"] }) }) });
  });

  it("revokes everything with an empty set, and writes nothing when nothing changed", async () => {
    held = ["reports.view"];
    expect(await setAdminPermissions(1, change({ permissions: [] }))).toMatchObject({ ok: true, removed: ["신고 조회"] });
    expect(audit).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "permissions_revoke" }) });
    vi.clearAllMocks(); held = ["reports.view"];
    expect(await setAdminPermissions(1, change({ permissions: ["reports.view"] }))).toMatchObject({ ok: true, unchanged: true });
    expect(audit).not.toHaveBeenCalled(); expect(createMany).not.toHaveBeenCalled();
  });

  it("requires an active agency for item permissions and leaves existing accounts alone otherwise", async () => {
    expect(await setAdminPermissions(1, change({ permissions: ["items.return"] }))).toEqual({ error: "물품 관리 권한에는 담당 기관을 선택해야 합니다." });
    organization.mockResolvedValue({ ...ACTIVE_ORG, managementCampus: null });
    expect(await setAdminPermissions(1, change({ permissions: ["items.return"], organizationId: 10 }))).toEqual({ error: "활성 관리 기관을 선택해주세요." });
    organization.mockResolvedValue(ACTIVE_ORG);
    expect(await setAdminPermissions(1, change({ permissions: ["items.return"], organizationId: 10, facility: "본관" }))).toMatchObject({ ok: true });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ userId: 2, organizationId: 10, facility: "본관", active: true }) }));
  });

  it("deactivates the agency scope when the last item permission goes, and warns about items left without a handler", async () => {
    held = ["items.return"];
    officer.mockResolvedValue({ userId: 2, active: true, organizationId: 10, facility: "본관" });
    postCount.mockResolvedValue(3);
    const result = await setAdminPermissions(1, change({ permissions: [] }));
    expect(officerUpdate).toHaveBeenCalledWith({ where: { userId: 2 }, data: { active: false } });
    expect(result).toMatchObject({ ok: true, warning: expect.stringContaining("3건") });
  });

  it("does not grant to withdrawn or suspended accounts", async () => {
    accounts[3] = { id: 3, isAdmin: false, withdrawnAt: new Date() };
    expect(await setAdminPermissions(1, change({ userId: 3 }))).toHaveProperty("error");
    accounts[3] = { id: 3, isAdmin: false, isSuspended: true, suspendedUntil: null };
    expect(await setAdminPermissions(1, change({ userId: 3 }))).toHaveProperty("error");
    accounts[3] = { id: 3, isAdmin: false };
    expect(createMany).not.toHaveBeenCalled();
  });

  it("a full administrator who is suspended or withdrawn cannot change permissions", async () => {
    accounts[1] = { id: 1, isAdmin: true, withdrawnAt: new Date() };
    expect(await setAdminPermissions(1, change())).toHaveProperty("error");
    accounts[1] = { id: 1, isAdmin: true };
  });
});

describe("기관 등록 (기관 관리 권한)", () => {
  it("needs 기관 관리, not just any admin permission", async () => {
    held = ["items.receive", "users.view"];
    expect(await saveInstitution(3, { name: "경비실", campus: "양쪽", type: "경비실" })).toEqual({ error: "기관 관리 권한이 필요합니다." });
    held = ["institutions.manage"];
    tx.organization.create.mockResolvedValue({ id: 5 });
    expect(await saveInstitution(3, { name: "경비실", campus: "양쪽", type: "경비실" })).toEqual({ ok: true });
  });
  it("does not let 기관 관리 grant item permissions to anyone", async () => {
    held = ["institutions.manage"];
    expect(await setAdminPermissions(3, change({ permissions: ["items.receive"], organizationId: 10 }))).toHaveProperty("error");
    expect(createMany).not.toHaveBeenCalled();
  });
});

describe("물품 관리 범위는 요청마다 DB에서 다시 확인한다", () => {
  const scoped = { active: true, organizationId: 10, facility: "본관", organization: { name: "경비실", status: "ACTIVE", managementCampus: "양쪽" } };
  it("needs an item permission AND an active agency", async () => {
    expect(await officerScope(2)).toBeNull();
    held = ["items.return"]; expect(await officerScope(2)).toBeNull(); // permission, no agency
    officer.mockResolvedValue(scoped);
    expect(await officerScope(2)).toMatchObject({ platform: false, organizationId: 10, permissions: ["items.return"] });
    held = ["reports.view"]; expect(await officerScope(2)).toBeNull(); // agency, but no item permission
  });
  it("drops the scope when the agency is inactive or the grant is deactivated", async () => {
    held = ["items.return"];
    officer.mockResolvedValue({ ...scoped, active: false }); expect(await officerScope(2)).toBeNull();
    officer.mockResolvedValue({ ...scoped, organization: { ...scoped.organization, status: "INACTIVE" } }); expect(await officerScope(2)).toBeNull();
  });
  it("gives a full administrator every item permission over all agencies", async () => {
    expect(await officerScope(1)).toMatchObject({ platform: true, permissions: ["items.receive", "items.custody", "items.return", "items.transfer", "items.restore"] });
  });
});
