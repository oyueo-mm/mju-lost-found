import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// 관리자 활동 tab: who gets every admin's records. Everything else on the
// page is out of scope here.
const requireAdmin = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireAdmin, requirePermission: requireAdmin, requireAnyPermission: requireAdmin }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { organization: { findMany: async () => [] }, user: { findMany: async () => [], count: async () => 1 }, adminPermissionGrant: { findMany: async () => [] } } }));
vi.mock("@/lib/metrics/operations", () => ({ AUDIENCE_NOTICE: "role snapshots", loadAdminOperations: async () => ({ daily: [], events: [], creation: [], since: null }) }));
const loadAdminActivity = vi.fn();
vi.mock("@/lib/metrics/adminActivity", async (importOriginal) => ({ ...(await importOriginal<object>()), loadAdminActivity }));
const loadReport = vi.fn();
const loadUserReport = vi.fn();
vi.mock("@/lib/metrics/report", async (importOriginal) => ({ ...(await importOriginal<object>()), loadReport }));
vi.mock("@/lib/metrics/userReport", async (importOriginal) => ({ ...(await importOriginal<object>()), loadUserReport }));
vi.mock("@/components/admin/AdminActivityView", () => ({
  AdminActivityView: ({ all }: { all: boolean }) => <div data-all={String(all)} />,
}));
// client components of the other tabs' header
vi.mock("@/components/admin/StatsPeriodPicker", () => ({ StatsPeriodPicker: () => <div data-testid="period" /> }));
vi.mock("@/components/admin/StatsExportPanel", () => ({ StatsExportPanel: () => <div /> }));

const { default: AdminStatsPage } = await import("./page");
const render = async (params: Record<string, string>) => renderToStaticMarkup(await AdminStatsPage({ searchParams: Promise.resolve(params) }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("/admin/stats?tab=admins", () => {
  it("an admin not named in ADMIN_ACTIVITY_VIEWER_IDS gets only their own records, whatever `a` asks", async () => {
    vi.stubEnv("ADMIN_ACTIVITY_VIEWER_IDS", "13");
    requireAdmin.mockResolvedValue({ id: 20, isAdmin: true });
    loadAdminActivity.mockResolvedValue({});
    const html = await render({ tab: "admins", a: "13", day: "2026-10-16", k: "login" });
    expect(loadAdminActivity).toHaveBeenCalledWith(expect.objectContaining({ viewer: 20, all: true, filter: { admin: 13, day: "2026-10-16", kind: "login", period: 30 }, range: expect.objectContaining({ unit: "day" }) }));
    expect(html).toContain('data-all="true"');
  });

  it("a named viewer gets every admin, and may narrow the timeline to one; bad filter values are dropped", async () => {
    vi.stubEnv("ADMIN_ACTIVITY_VIEWER_IDS", "13");
    requireAdmin.mockResolvedValue({ id: 13, isAdmin: true });
    loadAdminActivity.mockResolvedValue({});
    await render({ tab: "admins", a: "20", day: "2026-1-6", k: "everything", p: "7" });
    expect(loadAdminActivity).toHaveBeenCalledWith(expect.objectContaining({ viewer: 13, all: true, filter: { admin: 20, day: null, kind: null, period: 7 }, range: expect.objectContaining({ unit: "day" }) }));
  });

  it("has no period picker or export (they belong to the other tabs), and leaves their data alone", async () => {
    requireAdmin.mockResolvedValue({ id: 13, isAdmin: true });
    loadAdminActivity.mockResolvedValue({});
    const html = await render({ tab: "admins" });
    expect(html).toContain('aria-current="page"');
    expect(html).toMatch(/aria-current="page"[^>]*>관리자 활동</);
    expect(html).toContain('data-testid="period"');
    expect(html).toContain("관리자 서비스 이용");
    expect(loadReport).not.toHaveBeenCalled();
    expect(loadUserReport).not.toHaveBeenCalled();
  });
});

describe("통계 탭은 조회 권한별로 독립적이다", () => {
  const as = (...keys: string[]) => requireAdmin.mockResolvedValue({ id: 30, isAdmin: false, adminPermissions: keys });
  it("관리자 통계 권한이 없으면 tab=admins를 요청해도 관리자 활동을 읽지 않는다", async () => {
    as("stats.operations");
    loadReport.mockResolvedValue(undefined);
    await render({ tab: "admins" }).catch(() => undefined);
    expect(loadAdminActivity).not.toHaveBeenCalled();
  });
  it("관리자 통계 권한만 있으면 관리자 활동 탭만 보이고 개별 기록을 볼 수 있다", async () => {
    as("stats.admins");
    loadAdminActivity.mockResolvedValue({});
    const html = await render({ tab: "users" });
    expect(loadUserReport).not.toHaveBeenCalled();
    expect(loadAdminActivity).toHaveBeenCalledWith(expect.objectContaining({ viewer: 30, all: true }));
    expect(html).toContain("관리자 활동");
    expect(html).not.toContain("사용자 통계</a>");
    expect(html).not.toContain("개발 통계");
  });
  it("사용자 통계 권한만 있으면 운영·관리자 데이터는 읽지 않는다", async () => {
    as("stats.users");
    loadUserReport.mockResolvedValue({});
    await render({ tab: "ops" }).catch(() => undefined);
    expect(loadReport).not.toHaveBeenCalled();
    expect(loadAdminActivity).not.toHaveBeenCalled();
    expect(loadUserReport).toHaveBeenCalled();
  });
  it("개발 통계 탭은 전체 관리자에게만 열린다", async () => {
    as("stats.operations", "stats.users", "stats.admins", "promotion.manage");
    const html = await render({ tab: "admins" }).catch(() => "");
    expect(html).not.toContain("개발 통계");
  });
});
