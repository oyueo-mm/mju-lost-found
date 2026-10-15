import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { API_ROUTE_NOTES, describeRoute, methodOf } from "./apiRoutes";

// Every timed API handler has a written description: walk src/app/api and
// build the names lib/metrics/record.ts normalizeRoute() records.
function handlers(): string[] {
  const root = join(process.cwd(), "src/app/api");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "route.ts") {
        const path = `/api/${relative(root, dir).split(/[\\/]/).join("/")}`;
        if (path.includes("[...")) continue; // Auth.js, not timed
        const normalized = path.replace(/\[[a-zA-Z]+\]/g, "[id]");
        for (const m of readFileSync(full, "utf8").matchAll(/export (?:async )?(?:function|const) (GET|POST|PATCH|PUT|DELETE)\b/g)) {
          out.push(`${m[1]} ${normalized}`);
        }
      }
    }
  };
  walk(root);
  return out;
}

describe("API 비고", () => {
  it("describes every API handler in the app", () => {
    const found = handlers();
    expect(found.length).toBeGreaterThan(40);
    expect(found.filter((route) => !(route in API_ROUTE_NOTES))).toEqual([]);
  });

  it("describes /api/posts by mode, and never invents a description", () => {
    expect(describeRoute("GET /api/posts")).toBe("분실물·습득물 게시글 목록·키워드 검색");
    expect(describeRoute("POST /api/posts?mode=ai")).toBe("AI 검색 (문장·사진으로 찾기)");
    expect(describeRoute("GET /api/admin/settings")).toContain("자동 정리");
    expect(describeRoute("GET /api/unknown")).toBe("설명 없음");
    expect(methodOf("DELETE /api/posts/[id]")).toBe("DELETE");
    expect(methodOf("ai:text-embed")).toBe("내부");
  });
});
