import { afterEach, expect, it, vi } from "vitest";
import robots from "./robots";
import sitemap from "./sitemap";

afterEach(() => vi.unstubAllEnvs());

it("publishes only the main public pages on the canonical Production origin", () => {
  vi.stubEnv("VERCEL_ENV", "production");
  expect(sitemap().map(({ url }) => url)).toEqual([
    "https://mju-find.vercel.app/",
    "https://mju-find.vercel.app/lost",
    "https://mju-find.vercel.app/found",
  ]);
  expect(robots()).toMatchObject({
    rules: { disallow: expect.arrayContaining(["/admin", "/api/", "/chat", "/me", "/notifications"]) },
    sitemap: "https://mju-find.vercel.app/sitemap.xml",
  });
});

it("keeps Preview out of discovery through its own robots and sitemap routes", () => {
  vi.stubEnv("VERCEL_ENV", "preview");
  expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  expect(sitemap()).toEqual([]);
});
