import { describe, expect, it } from "vitest";

const { parseArgs, paramsOf, UPSERT_SQL } = await import("./record.mjs");

describe("배포 기록 스크립트", () => {
  it("writes the Preview database unless Production is asked for twice", () => {
    expect(parseArgs(["dpl_a"])).toMatchObject({ db: "preview", targets: ["dpl_a"] });
    expect(parseArgs(["https://x-oyueo.vercel.app/path"]).targets).toEqual(["x-oyueo.vercel.app"]);
    expect(() => parseArgs(["--db", "production", "dpl_a"])).toThrow("--confirm-production");
    expect(parseArgs(["--db", "production", "--confirm-production", "--all"])).toMatchObject({ db: "production", all: true, dbs: ["production"] });
    expect(parseArgs(["dpl_a"]).dbs).toEqual(["preview"]);
    expect(() => parseArgs(["--db", "both", "dpl_a"])).toThrow("--confirm-production");
    expect(parseArgs(["--db", "both", "--confirm-production", "dpl_a"]).dbs).toEqual(["preview", "production"]);
    expect(() => parseArgs([])).toThrow();
    expect(() => parseArgs(["--db", "staging", "dpl_a"])).toThrow();
  });

  it("upserts by deployment id, filling only what is known", () => {
    expect(UPSERT_SQL).toContain('ON CONFLICT ("id") DO UPDATE');
    expect(UPSERT_SQL).toContain('COALESCE(EXCLUDED."git_sha", d."git_sha")');
    const row = { id: "dpl_a", target: "production", url: null, gitSha: null, gitMessage: null, gitDirty: null, state: "ERROR", createdAt: "2026-10-19T00:00:00.000Z", readyAt: null };
    expect(paramsOf(row, "2026-10-19T01:00:00.000Z")).toEqual(["dpl_a", "production", null, null, null, null, "ERROR", "2026-10-19T00:00:00.000Z", null, "2026-10-19T01:00:00.000Z"]);
  });
});
