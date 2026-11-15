import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const requireAdminForApi = vi.fn();
vi.mock("@/lib/moderation/http", () => ({
  requireAdminForApi,
  jsonError: (status: number, message: string) => NextResponse.json({ message }, { status }),
  withErrorHandling: (fn: unknown) => fn,
}));
const getReportEvidenceImages = vi.fn();
vi.mock("@/lib/report/evidenceView", () => ({ getReportEvidenceImages }));
const { GET } = await import("./route");
const request = () => new NextRequest("https://example.test/api/admin/reports/9/evidence/0");
const params = (index = "0") => ({ params: Promise.resolve({ id: "9", index }) });
const fetchMock = vi.fn();
beforeEach(() => { vi.clearAllMocks(); requireAdminForApi.mockResolvedValue({ user: { id: 2 } }); vi.stubGlobal("fetch", fetchMock); });
describe("private evidence delivery", () => {
  it("checks current administrator access before signing or downloading", async () => {
    requireAdminForApi.mockResolvedValueOnce({ response: NextResponse.json({}, { status: 403 }) });
    expect((await GET(request(), params())).status).toBe(403);
    expect(getReportEvidenceImages).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("streams only the requested image with browser and CDN caching disabled", async () => {
    getReportEvidenceImages.mockResolvedValueOnce([{ index: 0, url: "https://signed.test/image" }]);
    fetchMock.mockResolvedValueOnce(new Response("image", { headers: { "content-type": "image/png" } }));
    const response = await GET(request(), params());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vercel-cdn-cache-control")).toBe("no-store");
    expect(response.headers.get("location")).toBeNull();
    expect(getReportEvidenceImages).toHaveBeenCalledWith({ id: 2 }, 9, 0);
    expect(fetchMock.mock.calls[0][1].cache).toBe("no-store");
  });
  it("rejects invalid indices, missing evidence and non-image responses", async () => {
    expect((await GET(request(), params("5"))).status).toBe(400);
    getReportEvidenceImages.mockResolvedValueOnce([]);
    expect((await GET(request(), params())).status).toBe(404);
    getReportEvidenceImages.mockResolvedValueOnce([{ index: 0, url: "https://signed.test/image" }]);
    fetchMock.mockResolvedValueOnce(new Response("<html>", { headers: { "content-type": "text/html" } }));
    expect((await GET(request(), params())).status).toBe(502);
  });
});
