import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

const requirePermission = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requirePermission }));
vi.mock("@/components/admin/UtmLinkBuilder", () => ({ UtmLinkBuilder: () => <div data-builder="shared" /> }));
const { default: Page } = await import("./page");
afterEach(() => vi.clearAllMocks());

it("uses the promotion permission and shared builder without granting statistics access", async () => {
  requirePermission.mockResolvedValue({ id: 1, isAdmin: false, adminPermissions: ["promotion.manage"] });
  const html = renderToStaticMarkup(await Page());
  expect(requirePermission).toHaveBeenCalledWith("promotion.manage");
  expect(html).toContain('data-builder="shared"');
  expect(html).not.toContain('href="/admin/stats"');
});

it("does not render the generator when the permission guard rejects access", async () => {
  requirePermission.mockRejectedValue(new Error("forbidden"));
  await expect(Page()).rejects.toThrow("forbidden");
});

it("links back to statistics only with its separate permission", async () => {
  requirePermission.mockResolvedValue({ id: 1, isAdmin: false, adminPermissions: ["promotion.manage", "stats.operations"] });
  expect(renderToStaticMarkup(await Page())).toContain('href="/admin/stats"');
});
