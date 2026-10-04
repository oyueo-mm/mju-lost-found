import { afterEach, describe, expect, it, vi } from "vitest";

const runRetention = vi.fn(async () => ({ messagesExpired: 0 }));
vi.mock("@/lib/retention/service", () => ({ runRetention }));
vi.mock("@/lib/posts/http", async () => {
  const response = await import("@/lib/posts/response");
  return { ...response };
});

const { GET } = await import("./route");
const call = (auth?: string) => GET(new Request("http://localhost/api/cron/retention", auth ? { headers: { authorization: auth } } : {}));

afterEach(() => {
  vi.unstubAllEnvs();
  runRetention.mockClear();
});

describe("GET /api/cron/retention", () => {
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
