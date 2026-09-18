import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireActiveUser = vi.fn();
const listActiveOrganizations = vi.fn();
const getMyOrganizationMemberships = vi.fn();
const getMyOrganizationJoinRequests = vi.fn();
const getMyPendingOrganizationCreationRequest = vi.fn();

vi.mock("@/lib/auth/session", () => ({ requireActiveUser }));
vi.mock("@/lib/organization/service", () => ({
  listActiveOrganizations,
  getMyOrganizationMemberships,
  getMyOrganizationJoinRequests,
  getMyPendingOrganizationCreationRequest,
}));
vi.mock("@/lib/i18n/server", () => ({
  getTranslator: vi.fn(async () => (key: string) => (key === "common.networkError" ? "네트워크 오류" : key)),
}));
vi.mock("@/components/organization/OrganizationHelpTooltip", () => ({ OrganizationHelpTooltip: () => null }));

const OrganizationsHubPage = (await import("./page")).default;

const activeOrganization = {
  id: 1,
  name: "총학생회",
  description: null,
  organizationType: "학생회",
  scope: "전체",
  contactEmail: null,
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date(),
};

async function renderPage(searchParams: { tab?: string; status?: string } = {}) {
  const stream = await renderToReadableStream(<OrganizationsHubPage searchParams={Promise.resolve(searchParams)} />);
  await stream.allReady;
  return new Response(stream).text();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  listActiveOrganizations.mockResolvedValue([]);
  getMyOrganizationMemberships.mockResolvedValue([]);
  getMyOrganizationJoinRequests.mockResolvedValue([]);
  getMyPendingOrganizationCreationRequest.mockResolvedValue(null);
});

afterEach(() => vi.restoreAllMocks());

describe("OrganizationsHubPage", () => {
  it("renders the public active-organization list without requiring a user", async () => {
    listActiveOrganizations.mockResolvedValueOnce([activeOrganization]);

    const markup = await renderPage();

    expect(markup).toContain("총학생회");
    expect(requireActiveUser).not.toHaveBeenCalled();
  });

  it("renders the empty state for a public empty list", async () => {
    const markup = await renderPage();

    expect(markup).toContain("등록된 단체가 없습니다");
  });

  it("requires an active user only for the my-organizations tab", async () => {
    requireActiveUser.mockResolvedValueOnce({ id: 7 });

    const markup = await renderPage({ tab: "my" });

    expect(requireActiveUser).toHaveBeenCalledOnce();
    expect(getMyOrganizationMemberships).toHaveBeenCalledWith(7);
    expect(markup).toContain("가입한 활성 단체가 없습니다");
  });

  it("renders a safe error state when the active-organization query fails", async () => {
    listActiveOrganizations.mockRejectedValueOnce(new Error("database timeout"));

    const markup = await renderPage();

    expect(markup).toContain("네트워크 오류");
    expect(markup).toContain("단체 목록을 불러오지 못했습니다");
  });
});
