import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin, getUserDetailForAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn(), getUserDetailForAdmin: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireAdmin }));
vi.mock("@/lib/admin/users", () => ({ getUserDetailForAdmin }));
vi.mock("@/lib/metrics/report", () => ({ COLLECTION_SINCE: { ops: "2026-10-15T03:35" } }));
vi.mock("@/components/admin/UserActionButtons", () => ({ UserActionButtons: () => null }));
vi.mock("@/components/user/AuthorLink", () => ({ AuthorLink: () => null }));
vi.mock("@/components/comment/MyCommentList", () => ({ MyCommentList: () => null }));

import AdminUserDetailPage from "./page";

const detail = {
  user: { id: 5, email: "target@example.test", nickname: "회원", publicId: "public-id", createdAt: new Date("2026-10-14T00:00:00Z") },
  name: "회원", googleLinked: true, lastLoginAt: new Date("2026-10-17T00:30:00Z"),
  lastActivityDay: "2026-10-16", lastActiveAt: new Date("2026-10-17T12:04:09.500Z"), lastActiveSince: "2026-10-17 09:05",
  lostPostCount: 0, foundPostCount: 0, commentCount: 0,
  reportsFiledCount: 0, reportsAgainstCount: 0, comments: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  requireAdmin.mockResolvedValue({ id: 1 });
  getUserDetailForAdmin.mockResolvedValue({ kind: "ok", data: detail });
});

describe("관리자 사용자 상세: 최근 로그인·활동 시각과 이용일", () => {
  it("separates the login time, the detected activity time (KST, to the second) and the measured KST date", async () => {
    const html = renderToStaticMarkup(await AdminUserDetailPage({ params: Promise.resolve({ id: "5" }) }));
    expect(html).toMatch(/최근 로그인 시각<\/dt><dd[^>]*>2026-10-17 09:30:00 \(KST\)<\/dd>/);
    expect(html).toMatch(/최근 활동 감지 시각<\/dt><dd[^>]*>2026-10-17 21:04:09 \(KST\)<\/dd>/);
    expect(html).toContain("최근 이용일");
    expect(html).toContain("2026-10-16 (KST)");
    // what the time is and is not, and how far off it can be
    expect(html).toContain("5분에 한 번");
    expect(html).toContain("최대 5분 늦을 수 있습니다");
    expect(html).toContain("로그아웃하거나 사이트를 떠난 시각이 아니며");
    expect(html).toContain("2026-10-17 09:05(KST)부터 기록");
    expect(html).toContain("2026-10-15 03:35");
    expect(html).toContain("400");
    expect(html).toContain("기록이 없어도 서비스를 이용하지 않았다는 뜻은 아닙니다");
    expect(getUserDetailForAdmin).toHaveBeenCalledWith({ id: 1 }, 5);
  });

  it("shows no record instead of using the existing login timestamp", async () => {
    getUserDetailForAdmin.mockResolvedValue({ kind: "ok", data: { ...detail, lastActivityDay: null, lastActiveAt: null } });
    const html = renderToStaticMarkup(await AdminUserDetailPage({ params: Promise.resolve({ id: "5" }) }));
    expect(html).toMatch(/최근 이용일<\/dt><dd[^>]*>기록 없음<\/dd>/);
    expect(html).toMatch(/최근 활동 감지 시각<\/dt><dd[^>]*>기록 없음<\/dd>/);
  });

  it("says 미측정 before this environment recorded any activity time", async () => {
    getUserDetailForAdmin.mockResolvedValue({ kind: "ok", data: { ...detail, lastActiveAt: null, lastActiveSince: null } });
    const html = renderToStaticMarkup(await AdminUserDetailPage({ params: Promise.resolve({ id: "5" }) }));
    expect(html).toMatch(/최근 활동 감지 시각<\/dt><dd[^>]*>미측정<\/dd>/);
    expect(html).toContain("아직 기록을 시작하지 않았습니다");
  });

  it("does not read target details if the page's admin gate rejects the caller", async () => {
    requireAdmin.mockRejectedValue(new Error("admin required"));
    await expect(AdminUserDetailPage({ params: Promise.resolve({ id: "5" }) })).rejects.toThrow("admin required");
    expect(getUserDetailForAdmin).not.toHaveBeenCalled();
  });
});
