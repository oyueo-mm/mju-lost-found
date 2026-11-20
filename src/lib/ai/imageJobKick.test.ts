import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { imageJobDrainUrl, kickImageJobs } from "./imageJobKick";

afterEach(() => vi.unstubAllGlobals());

describe("image job kick (Function Storage C-1)", () => {
  it("drains through this very deployment, never another environment", () => {
    expect(imageJobDrainUrl("http://localhost:3000", { VERCEL_URL: "mju-x-abc123-oyueo.vercel.app" } as unknown as NodeJS.ProcessEnv))
      .toBe("https://mju-x-abc123-oyueo.vercel.app/api/posts?mode=embedding-maintenance");
    expect(imageJobDrainUrl("http://localhost:3000", {} as unknown as NodeJS.ProcessEnv)).toBe("http://localhost:3000/api/posts?mode=embedding-maintenance");
  });

  it("authenticates with the cron secret and Vercel's automation bypass, and never throws", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const env = { CRON_SECRET: "c", VERCEL_AUTOMATION_BYPASS_SECRET: "b", VERCEL_URL: "d.vercel.app" } as unknown as NodeJS.ProcessEnv;
    expect(await kickImageJobs("http://x", env)).toBe("sent");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toEqual({ authorization: "Bearer c", "x-vercel-protection-bypass": "b" });
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 401 }));
    expect(await kickImageJobs("http://x", env)).toBe("failed");
    fetchMock.mockImplementationOnce(async () => { throw new Error("network"); });
    expect(await kickImageJobs("http://x", env)).toBe("failed");
    expect(await kickImageJobs("http://x", {} as unknown as NodeJS.ProcessEnv)).toBe("skipped");
  });

  it("keeps the photo route model-free: no import of the embedding chain", () => {
    const route = readFileSync(new URL("../../app/api/posts/[id]/image/route.ts", import.meta.url), "utf8");
    const kick = readFileSync(new URL("./imageJobKick.ts", import.meta.url), "utf8");
    for (const source of [route, kick]) expect(source).not.toMatch(/from "@\/lib\/ai\/(imageJob|imageEmbedding|embedding|postEmbedding)"|from "\.\/(imageJob|imageEmbedding|embedding)"/);
    const config = readFileSync(new URL("../../../next.config.ts", import.meta.url), "utf8");
    expect(config).not.toMatch(/"\/api\/posts\/\\\[id\\\]\/image!\(\/\*\*\)"/);
  });
});
