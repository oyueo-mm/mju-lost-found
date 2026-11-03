import { beforeEach, describe, expect, it, vi } from "vitest";
const user = vi.fn(), grants = vi.fn(), grant = vi.fn(), org = vi.fn(), find = vi.fn(), update = vi.fn(), history = vi.fn(), notification = vi.fn();
const tx = { user: { findUnique: user }, institutionOfficer: { findUnique: grant }, adminPermissionGrant: { findMany: grants }, organization: { findUnique: org }, foundPost: { findUnique: find, update }, lostPost: { findUnique: find, update }, postStatusChange: { create: history }, postReturn: { updateMany: vi.fn() }, notification: { create: notification }, $queryRaw: vi.fn() };
vi.mock("@/lib/db/prisma", () => ({ prisma: { $transaction: (fn: (db: typeof tx) => unknown) => fn(tx) } }));
const { managePost, inManagementScope } = await import("./management");
const ITEM_FOUR = ["items.receive", "items.custody", "items.return", "items.transfer"];
const now = new Date("2026-11-02T01:00:00Z");
const custody = { state: "REPORTED", place: "본관", confirmedAt: now.toISOString(), confirmedBy: 9, institution: "본관 경비실" };
const post = { id: 1, userId: 7, status: "KEEPING", campus: "자연캠퍼스", updatedAt: now, custody: null, custodyOrganizationId: null, pendingTransferOrganizationId: null };
const input = (action: string, more = {}) => ({ action, expectedUpdatedAt: now.toISOString(), confirmed: true, ...more });
const officer = (organizationId = 1) => ({ organizationId, active: true, facility: "본관", organization: { name: "본관 경비실", status: "ACTIVE", managementCampus: "인문캠퍼스" } });
beforeEach(() => {
  vi.clearAllMocks(); grants.mockResolvedValue(ITEM_FOUR.map((permission) => ({ permission })));
  user.mockResolvedValue({ id: 9, email: "officer@example.org", isAdmin: false });
  grant.mockResolvedValue(officer()); org.mockResolvedValue({ name: "본관 경비실", status: "ACTIVE", managementCampus: "인문캠퍼스" });
  find.mockResolvedValue(post); update.mockResolvedValue({ ...post, updatedAt: new Date() }); history.mockResolvedValue({ id: 100 });
});
describe("기관 물품 관리 권한과 원자적 상태 변경", () => {
  it("clears the location when withdrawing a mistaken confirmation without relabeling it as an author report", async () => {
    user.mockResolvedValue({ id: 9, isAdmin: true });
    find.mockResolvedValue({ ...post, custody, custodyOrganizationId: 1 });
    expect((await managePost(9, "found", 1, input("release", { reason: "접수 오류" }))).status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ custodyOrganizationId: null, custody: { state: "UNKNOWN", place: "", confirmedAt: null, confirmedBy: null, institution: null } }) }));
    expect(history).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ beforeCustody: custody, reason: "접수 오류" }) }));
  });
  it("does not grant authority from external approval or ordinary org membership", async () => {
    grant.mockResolvedValue(null);
    expect((await managePost(9, "found", 1, input("confirm", { place: "본관" }))).status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });
  it("rejects withdrawn and suspended service admins", async () => {
    for (const extra of [{ deletedAt: now }, { withdrawnAt: now }, { isSuspended: true, suspendedUntil: null }]) {
      user.mockResolvedValue({ id: 9, isAdmin: true, ...extra });
      expect((await managePost(9, "found", 1, input("complete"))).status).toBe(403);
    }
  });
  it("permits receipt regardless of discovery campus, but not takeover of another agency", async () => {
    const scope = { platform: false, campus: "인문캠퍼스", institution: "A", facility: "", organizationId: 1, permissions: [] as never[] };
    expect(inManagementScope(scope, "자연캠퍼스", null)).toBe(true);
    expect(inManagementScope(scope, "인문캠퍼스", custody as never, 2)).toBe(false);
    expect(inManagementScope(scope, "인문캠퍼스", custody as never)).toBe(false);
    expect((await managePost(9, "found", 1, input("confirm", { place: "본관" }))).status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ custodyOrganizationId: 1 }) }));
    expect(history).toHaveBeenCalled(); expect(notification).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ relatedType: "post_status_change", relatedId: 100 }) }));
  });
  it("requires attestation and forbids ordinary content payloads", async () => {
    expect((await managePost(9, "found", 1, input("confirm", { place: "A", confirmed: false }))).status).toBe(400);
    expect((await managePost(9, "found", 1, input("complete", { title: "forged" }))).status).toBe(400);
  });
  it("requires own agency receipt before return and rejects stale requests", async () => {
    expect((await managePost(9, "found", 1, input("complete"))).status).toBe(403);
    find.mockResolvedValue({ ...post, custody, custodyOrganizationId: 1 });
    expect((await managePost(9, "found", 1, input("complete"))).status).toBe(200);
    expect((await managePost(9, "found", 1, input("complete", { expectedUpdatedAt: "2026-11-01T00:00:00Z" }))).status).toBe(409);
    grant.mockResolvedValue(officer(2));
    expect((await managePost(9, "found", 1, input("complete"))).status).toBe(403);
  });
  it("keeps current responsibility until the requested recipient accepts", async () => {
    find.mockResolvedValue({ ...post, custody, custodyOrganizationId: 1 });
    expect((await managePost(9, "found", 1, input("transfer_request", { organizationId: 2 }))).status).toBe(200);
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ custodyOrganizationId: 1, pendingTransferOrganizationId: 2 }) }));
    find.mockResolvedValue({ ...post, custody, custodyOrganizationId: 1, pendingTransferOrganizationId: 2 });
    expect((await managePost(9, "found", 1, input("transfer_accept", { place: "학생지원팀" }))).status).toBe(403);
    expect((await managePost(9, "found", 1, input("complete"))).status).toBe(409);
    grant.mockResolvedValue(officer(2));
    expect((await managePost(9, "found", 1, input("transfer_accept", { place: "학생지원팀" }))).status).toBe(200);
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ custodyOrganizationId: 2, pendingTransferOrganizationId: null }) }));
  });
  it("allows service-only correction and restoration with mandatory reasons", async () => {
    find.mockResolvedValue({ ...post, custody, custodyOrganizationId: 1, status: "COMPLETED" });
    expect((await managePost(9, "found", 1, input("reopen"))).status).toBe(400);
    expect((await managePost(9, "found", 1, input("reopen", { reason: "wrong return" }))).status).toBe(403);
    user.mockResolvedValue({ id: 9, isAdmin: true });
    expect((await managePost(9, "found", 1, input("reopen", { reason: "wrong return" }))).status).toBe(200);
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ custodyOrganizationId: 1, custody }) }));
  });
  it("does not let institution officers complete an unrelated lost post", async () => {
    find.mockResolvedValue({ ...post, status: "SEARCHING" });
    expect((await managePost(9, "lost", 1, input("complete"))).status).toBe(403);
    user.mockResolvedValue({ id: 9, isAdmin: true });
    expect((await managePost(9, "lost", 1, input("complete"))).status).toBe(200);
  });
});

describe("세부 권한별 물품 작업 (권한과 관리 범위를 모두 검사)", () => {
  const own = () => find.mockResolvedValue({ ...post, custody, custodyOrganizationId: 1 });
  const only = (...keys: string[]) => grants.mockResolvedValue(keys.map((permission) => ({ permission })));
  it("a return-only account cannot confirm receipt, change the place, or transfer", async () => {
    only("items.return"); own();
    expect((await managePost(9, "found", 1, input("location", { place: "새 장소" }))).status).toBe(403);
    expect((await managePost(9, "found", 1, input("transfer_request", { organizationId: 2 }))).status).toBe(403);
    find.mockResolvedValue(post);
    expect((await managePost(9, "found", 1, input("confirm", { place: "본관" }))).status).toBe(403);
    expect(update).not.toHaveBeenCalled();
    own();
    expect((await managePost(9, "found", 1, input("complete"))).status).toBe(200);
  });
  it("without 보관 관리 the place cannot change, without 기관 인계 nothing can be handed over", async () => {
    only("items.receive", "items.return"); own();
    expect((await managePost(9, "found", 1, input("location", { place: "x" }))).status).toBe(403);
    expect((await managePost(9, "found", 1, input("transfer_cancel"))).status).toBe(403);
  });
  it("restore needs its own permission, and only inside the account's own agency", async () => {
    find.mockResolvedValue({ ...post, custody, custodyOrganizationId: 1, status: "COMPLETED" });
    expect((await managePost(9, "found", 1, input("reopen", { reason: "잘못 반환" }))).status).toBe(403);
    only("items.restore");
    expect((await managePost(9, "found", 1, input("reopen", { reason: "잘못 반환" }))).status).toBe(200);
    grant.mockResolvedValue(officer(2));
    expect((await managePost(9, "found", 1, input("reopen", { reason: "다른 기관" }))).status).toBe(403);
  });
  it("a permission without an agency scope can do nothing, and a scope without a permission neither", async () => {
    grant.mockResolvedValue(null);
    expect((await managePost(9, "found", 1, input("confirm", { place: "본관" }))).status).toBe(403);
    grant.mockResolvedValue(officer()); grants.mockResolvedValue([]);
    expect((await managePost(9, "found", 1, input("confirm", { place: "본관" }))).status).toBe(403);
  });
  it("lost posts stay with full administrators even with every item permission", async () => {
    only(...ITEM_FOUR, "items.restore");
    find.mockResolvedValue({ ...post, status: "SEARCHING" });
    expect((await managePost(9, "lost", 1, input("complete"))).status).toBe(403);
  });
  it("a revoked permission stops the very next request", async () => {
    own(); expect((await managePost(9, "found", 1, input("complete"))).status).toBe(200);
    grants.mockResolvedValue([]);
    expect((await managePost(9, "found", 1, input("complete"))).status).toBe(403);
  });
});
