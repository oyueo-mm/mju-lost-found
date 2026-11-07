import { afterEach, describe, expect, it, vi } from "vitest";

async function loadImagesConfig(env: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const { default: config } = await import("../../../next.config");
  return config.images!;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("next.config images (Vercel 이미지 변환량)", () => {
  it("transforms a photo into four widths at most, cached for 31 days", async () => {
    const images = await loadImagesConfig({ VERCEL_ENV: "production" });
    expect([...images.imageSizes!, ...images.deviceSizes!]).toEqual([128, 256, 640, 1080]);
    expect(images.minimumCacheTTL).toBe(2678400);
  });

  it("optimizes on Production and in local builds, never on Preview unless that deployment turns it on", async () => {
    expect((await loadImagesConfig({ VERCEL_ENV: "production" })).unoptimized).toBe(false);
    expect((await loadImagesConfig({ VERCEL_ENV: "" })).unoptimized).toBe(false);
    expect((await loadImagesConfig({ VERCEL_ENV: "preview" })).unoptimized).toBe(true);
    expect((await loadImagesConfig({ VERCEL_ENV: "preview", PREVIEW_IMAGE_OPTIMIZATION: "on" })).unoptimized).toBe(false);
  });
});
