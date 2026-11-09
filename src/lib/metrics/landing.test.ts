import { describe, expect, it } from "vitest";
import { gateReturnPath, landingTags, postLandingPath } from "./landing";
import { onboardingUrl } from "@/lib/auth/onboardingUrl";
import { buildUtmLink } from "./utmLink";

describe("poster landing through protected registration", () => {
  it("preserves Content through parent gates and nested login/onboarding return paths", () => {
    const callback = postLandingPath("/found/new", { utm_source: "poster_qr", utm_medium: "offline", utm_campaign: "poster_2026_11", utm_content: "h_jonghap_guard_reg" });
    expect(gateReturnPath(callback)).toBe(callback);
    expect(landingTags(`?callbackUrl=${encodeURIComponent(onboardingUrl(callback))}`).get("utm_content")).toBe("h_jonghap_guard_reg");
  });
  it("lets the parent layout preserve only safe registration return paths", () => {
    expect(gateReturnPath("/found/new?utm_source=poster_qr&secret=private")).toBe("/found/new?utm_source=poster_qr");
    expect(gateReturnPath("/admin")).toBeUndefined();
    expect(gateReturnPath("//evil.com/found/new")).toBeUndefined();
  });
  it("keeps all 16 guard campaigns distinct and readable by the real collector", () => {
    const campaigns = new Set<string>();
    for (let i = 1; i <= 8; i++) for (const purpose of ["find", "register"]) {
      const campaign = `h_guard${String(i).padStart(2, "0")}_${purpose}`;
      const result = buildUtmLink({ path: purpose === "find" ? "/found" : "/found/new", source: "poster_qr", medium: "offline", campaign });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("invalid poster");
      const url = new URL(result.link);
      const params = Object.fromEntries(url.searchParams);
      const callback = postLandingPath("/found/new", params);
      // Login -> consent -> nickname -> registration: the first rendered
      // auth page still exposes the tags through a safe nested callback.
      for (const path of [callback, onboardingUrl(callback)]) {
        const tags = landingTags(`?callbackUrl=${encodeURIComponent(path)}`);
        expect(tags.get("utm_campaign")).toBe(campaign);
        expect(tags.get("utm_source")).toBe("poster_qr");
        expect(tags.get("utm_medium")).toBe("offline");
      }
      campaigns.add(campaign);
    }
    expect(campaigns.size).toBe(16);
  });

  it("drops arbitrary query data, repeated tags, unsafe return URLs and invalid tags", () => {
    expect(postLandingPath("/found/new", { utm_source: "poster_qr", utm_campaign: "email@example.com", utm_medium: ["a", "b"], after: "12", secret: "private" }))
      .toBe("/found/new?utm_source=poster_qr&after=12");
    expect(landingTags("?callbackUrl=https%3A%2F%2Fevil.com%2F%3Futm_source%3Dposter_qr").get("utm_source")).toBeNull();
    expect(onboardingUrl("//evil.com")).toBe("/onboarding");
  });
});
