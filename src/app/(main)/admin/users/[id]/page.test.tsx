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
  lastActivityDay: "2026-10-16", lostPostCount: 0, foundPostCount: 0, commentCount: 0,
  reportsFiledCount: 0, reportsAgainstCount: 0, comments: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  requireAdmin.mockResolvedValue({ id: 1 });
  getUserDetailForAdmin.mockResolvedValue({ kind: "ok", data: detail });
});

describe("관리자 사용자 상세: 최근 이용일", () => {
  it("separates the measured KST date from the login timestamp and explains coverage", async () => {
    const html = renderToStaticMarkup(await AdminUserDetailPage({ params: Promise.resolve({ id: "5" }) }));
    expect(html).toContain("마지막 로그인");
    expect(html).toContain("최근 이용일");
    expect(html).toContain("2026-10-16 (KST)");
    expect(html).toContain("정확한 방문 시각은 측정하지 않습니다");
    expect(html).toContain("2026-10-15 03:35");
    expect(html).toContain("400");
    expect(html).toContain("기록이 없어도 서비스를 이용하지 않았다는 뜻은 아닙니다");
    expect(getUserDetailForAdmin).toHaveBeenCalledWith({ id: 1 }, 5);
  });

  it("shows no record instead of using the existing login timestamp", async () => {
    getUserDetailForAdmin.mockResolvedValue({ kind: "ok", data: { ...detail, lastActivityDay: null } });
    const html = renderToStaticMarkup(await AdminUserDetailPage({ params: Promise.resolve({ id: "5" }) }));
    expect(html).toMatch(/최근 이용일<\/dt><dd[^>]*>기록 없음<\/dd>/);
  });

  it("does not read target details if the page's admin gate rejects the caller", async () => {
    requireAdmin.mockRejectedValue(new Error("admin required"));
    await expect(AdminUserDetailPage({ params: Promise.resolve({ id: "5" }) })).rejects.toThrow("admin required");
    expect(getUserDetailForAdmin).not.toHaveBeenCalled();
  });
});
