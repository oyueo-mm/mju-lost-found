import { describe, expect, it } from "vitest";

import { ACCENT_COLORS, DEFAULT_ACCENT, normalizeCustomAccent, resolveStoredAccent } from "./constants";

describe("theme accent preferences", () => {
  it("keeps the six requested presets in display order with Myongji blue as the default", () => {
    expect(DEFAULT_ACCENT).toBe("mjuBlue");
    expect(ACCENT_COLORS.map((accent) => [accent.value, accent.swatch])).toEqual([
      ["mjuBlue", "#006ec7"],
      ["mjuDarkBlue", "#002968"],
      ["pink", "#ff00dd"],
      ["rose", "#ff3d6e"],
      ["lavender", "#7c3aed"],
      ["green", "#059669"],
    ]);
  });

  it("normalizes HEX and RGB custom colors while rejecting invalid values", () => {
    expect(normalizeCustomAccent("#2F6Fed")).toBe("#2f6fed");
    expect(normalizeCustomAccent("rgb(47, 111, 237)")).toBe("#2f6fed");
    expect(normalizeCustomAccent("rgb(256, 111, 237)")).toBeNull();
    expect(normalizeCustomAccent("blue")).toBeNull();
  });

  it("restores a valid custom color ahead of a stale preset and safely falls back otherwise", () => {
    expect(resolveStoredAccent("mjuBlue", "#2F6Fed")).toEqual({ accent: "custom", customAccent: "#2f6fed" });
    expect(resolveStoredAccent("custom", "not-a-color")).toEqual({ accent: "mjuBlue", customAccent: null });
    expect(resolveStoredAccent("green", null)).toEqual({ accent: "green", customAccent: null });
    expect(resolveStoredAccent("blue", null)).toEqual({ accent: "mjuBlue", customAccent: null });
  });
});
