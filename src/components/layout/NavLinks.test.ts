import { describe, expect, it } from "vitest";

import { DESKTOP_ADMIN_NAV_ITEM, DESKTOP_NAV_ITEMS, DESKTOP_PROFILE_NAV_ITEM, NAV_ITEMS, isNavActive } from "./NavLinks";

describe("desktop navigation links", () => {
  it("keeps the mobile tab list free of desktop-only dropdown entries", () => {
    expect(NAV_ITEMS.map((item) => item.key)).toEqual(["home", "lost", "found", "chat", "me"]);
  });

  it("keeps lost and found as direct desktop routes", () => {
    expect(DESKTOP_NAV_ITEMS.filter((item) => item.key === "lost" || item.key === "found").map((item) => item.href)).toEqual([
      "/lost",
      "/found",
    ]);
    expect(DESKTOP_NAV_ITEMS.find((item) => item.key === "search")?.children?.map((item) => item.href)).toEqual([
      "/search?mode=semantic&type=found",
      "/search?mode=keyword&type=found",
    ]);
  });

  it("limits administrator dropdown links to existing admin routes", () => {
    expect(DESKTOP_ADMIN_NAV_ITEM.children?.map((item) => item.href)).toEqual([
      "/admin/reports",
      "/admin/feedback",
      "/admin/posts",
      "/admin/users",
      "/admin/announcements",
      "/admin/organizations",
      "/admin/organization-requests",
      "/admin/sanctions",
    ]);
  });

  it("keeps account actions on existing routes and preserves sign-out as an action", () => {
    const account = DESKTOP_PROFILE_NAV_ITEM;
    expect(account?.children?.map((item) => item.href)).toEqual([
      "/me",
      "/posts/mine",
      "/notifications",
      "/feedback",
      "/me#display-settings",
      undefined,
    ]);
    expect(account?.children?.at(-1)?.action).toBe("signOut");
  });

  it("gives every desktop dropdown entry an existing icon mapping", () => {
    expect(
      [...DESKTOP_NAV_ITEMS, DESKTOP_ADMIN_NAV_ITEM]
        .flatMap((item) => item.children ?? [])
        .every((item) => Boolean(item.icon)),
    ).toBe(true);
  });

  it("marks each direct board route active independently", () => {
    expect(isNavActive("lost", "/lost", "/lost/new")).toBe(true);
    expect(isNavActive("found", "/found", "/found/new")).toBe(true);
    expect(isNavActive("lost", "/lost", "/found")).toBe(false);
  });
});
