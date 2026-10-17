import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const runRetention = vi.fn(async () => ({ messagesExpired: 0 }));
vi.mock("@/lib/retention/service", () => ({ runRetention }));
const setGoogleTestMode = vi.fn();
vi.mock("@/lib/settings/service", () => ({ setGoogleTestMode }));
const requireAdminForApi = vi.fn();
vi.mock("@/lib/moderation/http", async () => {
  const response = await import("@/lib/posts/response");
  return { ...response, requireAdminForApi };
});
const recordAdminActivity = vi.fn();
vi.mock("@/lib/admin/activityLog", () => ({ recordAdminActivity }));

const { GET, PATCH } = await import("./route");
const call = (auth?: string) => GET(new NextRequest("http://localhost/api/admin/settings", auth ? { headers: { authorization: auth } } : {}));

afterEach(() => {
  vi.unstubAllEnvs();
  runRetention.mockClear();
});

describe("GET /api/admin/settings (retention cron)", () => {
  it("does nothing without a configured CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer anything")).status).toBe(503);
    expect(runRetention).not.toHaveBeenCalled();
  });

  it("refuses a missing or wrong secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect(runRetention).not.toHaveBeenCalled();
  });

  it("runs the clean-up for Vercel Cron's bearer secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    const res = await call("Bearer s3cret-value");
    expect(res.status).toBe(200);
    expect(runRetention).toHaveBeenCalledTimes(1);
  });
});

describe("PATCH /api/admin/settings (관리자 활동)", () => {
  const patch = (body: unknown) =>
    PATCH(new NextRequest("http://localhost/api/admin/settings", { method: "PATCH", body: JSON.stringify(body) }));

  it("records the change only after it was saved", async () => {
    requireAdminForApi.mockResolvedValueOnce({ user: { id: 7, isAdmin: true } });
    setGoogleTestMode.mockResolvedValueOnce({ kind: "ok", data: { googleTestModeEnabled: true } });
    expect((await patch({ googleTestModeEnabled: true })).status).toBe(200);
    expect(recordAdminActivity).toHaveBeenCalledWith(7, "settings.update");
  });

  it("records nothing for a refused or invalid request", async () => {
    recordAdminActivity.mockClear();
    requireAdminForApi.mockResolvedValueOnce({ user: { id: 7, isAdmin: true } });
    expect((await patch({ googleTestModeEnabled: "yes" })).status).toBe(400);
    requireAdminForApi.mockResolvedValueOnce({ user: { id: 7, isAdmin: true } });
    setGoogleTestMode.mockResolvedValueOnce({ kind: "forbidden" });
    expect((await patch({ googleTestModeEnabled: false })).status).toBe(403);
    expect(recordAdminActivity).not.toHaveBeenCalled();
  });
});
