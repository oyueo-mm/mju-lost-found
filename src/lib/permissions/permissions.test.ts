import { describe, expect, it } from "vitest";

import { can, canAny, hasAnyAdminPermission } from "./check";
import {
  ADMIN_MENU, GRANTABLE_PERMISSION_KEYS, PERMISSION_GROUPS, PERMISSION_INFO, PERMISSION_KEYS, PERMISSION_PRESETS,
  isGrantablePermissionKey, matchingPresetId, withRequiredPermissions,
} from "./definitions";

describe("permission list", () => {
  it("has 19 permissions in 8 groups, each exactly once, all with Korean label and description", () => {
    expect(PERMISSION_KEYS).toHaveLength(19);
    expect(PERMISSION_GROUPS).toHaveLength(8);
    expect(PERMISSION_GROUPS.flatMap((g) => g.keys).sort()).toEqual([...PERMISSION_KEYS].sort());
    for (const key of PERMISSION_KEYS) {
      expect(PERMISSION_INFO[key].label).toMatch(/[가-힣]/);
      expect(PERMISSION_INFO[key].description.length).toBeGreaterThan(5);
      expect(PERMISSION_INFO[key].label).not.toContain(".");
    }
    expect(PERMISSION_GROUPS.map((g) => g.keys.length)).toEqual([5, 2, 2, 2, 3, 2, 2, 1]);
  });

  it("keeps 권한 관리 out of anything that can be stored", () => {
    expect(GRANTABLE_PERMISSION_KEYS).toHaveLength(18);
    expect(isGrantablePermissionKey("permissions.manage")).toBe(false);
    expect(isGrantablePermissionKey("nonsense")).toBe(false);
    expect(PERMISSION_PRESETS.flatMap((p) => p.keys)).not.toContain("permissions.manage");
  });
});

describe("can()", () => {
  it("gives a full administrator everything, including 권한 관리", () => {
    for (const key of PERMISSION_KEYS) expect(can({ isAdmin: true }, key)).toBe(true);
  });
  it("gives anyone else exactly what was granted, and never 권한 관리 -- even if such a row existed", () => {
    const user = { isAdmin: false, adminPermissions: ["reports.view", "permissions.manage"] };
    expect(can(user, "reports.view")).toBe(true);
    expect(can(user, "reports.process")).toBe(false);
    expect(can(user, "permissions.manage")).toBe(false);
    expect(can(null, "reports.view")).toBe(false);
    expect(can({}, "reports.view")).toBe(false);
  });
  it("keeps independent permissions independent", () => {
    const stats = { isAdmin: false, adminPermissions: ["stats.operations"] };
    expect(can(stats, "stats.users")).toBe(false);
    expect(can(stats, "stats.admins")).toBe(false);
    const view = { isAdmin: false, adminPermissions: ["users.view"] };
    expect(can(view, "users.sanction")).toBe(false);
    expect(can({ isAdmin: false, adminPermissions: ["posts.manage"] }, "posts.delete")).toBe(false);
    expect(can({ isAdmin: false, adminPermissions: ["institutions.manage"] }, "items.receive")).toBe(false);
    expect(can({ isAdmin: false, adminPermissions: ["access.external"] }, "institutions.manage")).toBe(false);
  });
  it("shows the admin menu only to someone with at least one permission", () => {
    expect(hasAnyAdminPermission(null)).toBe(false);
    expect(hasAnyAdminPermission({ isAdmin: false, adminPermissions: [] })).toBe(false);
    expect(hasAnyAdminPermission({ isAdmin: false, adminPermissions: ["permissions.manage"] })).toBe(false);
    expect(hasAnyAdminPermission({ isAdmin: false, adminPermissions: ["reports.view"] })).toBe(true);
    expect(hasAnyAdminPermission({ isAdmin: true })).toBe(true);
    expect(canAny({ isAdmin: false, adminPermissions: ["posts.delete"] }, ["posts.manage", "posts.delete"])).toBe(true);
  });
});

describe("presets and dependencies", () => {
  it("only pre-fill: the presets match the spec and an edited set becomes 직접 설정", () => {
    const by = Object.fromEntries(PERMISSION_PRESETS.map((p) => [p.label, p.keys]));
    expect(by["일반 사용자"]).toEqual([]);
    expect(by["물품 관리 담당"]).toEqual(["items.receive", "items.custody", "items.return", "items.transfer"]);
    expect(by["콘텐츠 관리 담당"]).toEqual(["posts.manage", "reports.view", "reports.process"]);
    expect(by["운영·홍보 담당"]).toEqual(["stats.operations", "stats.users", "promotion.manage"]);
    expect(matchingPresetId(by["물품 관리 담당"])).toBe("items");
    expect(matchingPresetId([...by["물품 관리 담당"], "stats.admins"])).toBe("custom");
    expect(matchingPresetId([])).toBe("none");
  });
  it("adds the permission a selection needs (process needs view, sanction needs view) but not posts.delete from posts.manage", () => {
    expect(withRequiredPermissions(["reports.process"])).toEqual(["reports.view", "reports.process"]);
    expect(withRequiredPermissions(["users.sanction"])).toEqual(["users.view", "users.sanction"]);
    expect(withRequiredPermissions(["posts.manage"])).toEqual(["posts.manage"]);
  });
});

describe("admin menu", () => {
  const visible = (perms: string[], isAdmin = false) => ADMIN_MENU.filter((m) => m.anyOf.some((k) => can({ isAdmin, adminPermissions: perms }, k))).map((m) => m.label);
  it("shows only the entries a permission opens", () => {
    expect(visible([])).toEqual([]);
    expect(visible(["items.return"])).toEqual(["물품 관리"]);
    expect(visible(["reports.view"])).toEqual(["신고 관리"]);
    expect(visible(["stats.users"])).toEqual(["통계"]);
    expect(visible(["reports.view", "access.external"])).toEqual(["신고 관리", "외부 관계자 승인"]);
    expect(visible([], true)).toHaveLength(ADMIN_MENU.length);
  });
});
