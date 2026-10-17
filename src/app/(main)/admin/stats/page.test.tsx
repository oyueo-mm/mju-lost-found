import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// 관리자 활동 tab: who gets every admin's records. Everything else on the
// page is out of scope here.
const requireAdmin = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireAdmin }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
const loadAdminActivity = vi.fn();
vi.mock("@/lib/metrics/adminActivity", async (importOriginal) => ({ ...(await importOriginal<object>()), loadAdminActivity }));
const loadReport = vi.fn();
const loadUserReport = vi.fn();
vi.mock("@/lib/metrics/report", async (importOriginal) => ({ ...(await importOriginal<object>()), loadReport }));
vi.mock("@/lib/metrics/userReport", async (importOriginal) => ({ ...(await importOriginal<object>()), loadUserReport }));
vi.mock("@/components/admin/AdminActivityView", () => ({
  AdminActivityView: ({ all, focus }: { all: boolean; focus: number | null }) => <div data-all={String(all)} data-focus={String(focus)} />,
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
    const html = await render({ tab: "admins", a: "13" });
    expect(loadAdminActivity).toHaveBeenCalledWith({ viewer: 20, all: false, focus: null });
    expect(html).toContain('data-all="false"');
  });

  it("a named viewer gets every admin, and may focus the history on one", async () => {
    vi.stubEnv("ADMIN_ACTIVITY_VIEWER_IDS", "13");
    requireAdmin.mockResolvedValue({ id: 13, isAdmin: true });
    loadAdminActivity.mockResolvedValue({});
    await render({ tab: "admins", a: "20" });
    expect(loadAdminActivity).toHaveBeenCalledWith({ viewer: 13, all: true, focus: 20 });
  });

  it("has no period picker or export (they belong to the other tabs), and leaves their data alone", async () => {
    requireAdmin.mockResolvedValue({ id: 13, isAdmin: true });
    loadAdminActivity.mockResolvedValue({});
    const html = await render({ tab: "admins" });
    expect(html).toContain('aria-current="page"');
    expect(html).toMatch(/aria-current="page"[^>]*>관리자 활동</);
    expect(html).not.toContain('data-testid="period"');
    expect(html).not.toContain("내보내기");
    expect(loadReport).not.toHaveBeenCalled();
    expect(loadUserReport).not.toHaveBeenCalled();
  });
});
