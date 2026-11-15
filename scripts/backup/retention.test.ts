import { describe, expect, it } from "vitest";

import { isoWeek, planRetention, selectKeep } from "./retention.mjs";

const days = (from: string, n: number) => {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
};
const filesFor = (list: string[], verified = true) => list.flatMap((d) => [`auto-${d}.tar.enc`, ...(verified ? [`auto-${d}.tar.enc.verified.json`] : [])]);

describe("isoWeek", () => {
  it("uses Monday-based ISO weeks, including year boundaries", () => {
    expect(isoWeek("2026-11-15")).toBe("2026-W46"); // Sunday
    expect(isoWeek("2026-11-16")).toBe("2026-W47"); // Monday
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
    expect(isoWeek("2026-01-01")).toBe("2026-W01");
  });
});

describe("selectKeep (7 daily / 4 weekly / 3 monthly)", () => {
  it("keeps everything while there are only a few backups", () => {
    const list = days("2026-11-10", 5);
    expect([...selectKeep(list)].sort()).toEqual(list);
  });

  it("after 120 daily backups keeps the newest 7, one per newest 4 weeks and one per newest 3 months", () => {
    const list = days("2026-07-20", 120); // up to 2026-11-16
    const keep = [...selectKeep(list)].sort();
    expect(keep.slice(-7)).toEqual(days("2026-11-10", 7));
    expect(keep).toContain("2026-09-30"); // September (month slot)
    expect(keep).not.toContain("2026-08-31"); // only 3 months
    expect(keep.length).toBeGreaterThanOrEqual(7);
    expect(keep.length).toBeLessThanOrEqual(7 + 4 + 3);
  });

  it("with gaps (PC off) still keeps the newest backups first", () => {
    const list = ["2026-11-01", "2026-11-08", "2026-11-15", "2026-10-03", "2026-09-05", "2026-08-01"];
    const keep = selectKeep(list);
    expect([...keep].sort()).toEqual(["2026-08-01", "2026-09-05", "2026-10-03", "2026-11-01", "2026-11-08", "2026-11-15"]);
  });
});

describe("planRetention", () => {
  it("prunes only verified auto-* archives that fall outside the policy", () => {
    const list = days("2026-07-20", 120);
    const plan = planRetention(filesFor(list), { today: "2026-11-16" });
    expect(plan.managed).toHaveLength(120);
    expect(plan.keep.length + plan.prune.length).toBe(120);
    expect(plan.prune).not.toContain("auto-2026-11-16.tar.enc");
  });

  it("never touches unverified archives, weekly-*, pre-release backups or plaintext folders", () => {
    const files = [
      ...filesFor(days("2026-07-01", 60)),
      ...filesFor(["2026-05-01", "2026-05-02"], false), // failed / unchecked
      "weekly-2026-10-16.tar.enc", "weekly-2026-11-01.tar.enc",
      "production-2026-10-16-224144-pre-release.tar.enc",
      "auto-2026-04-01", // plaintext folder name
      "backup.log", "backup-status.json",
    ];
    const plan = planRetention(files, { today: "2026-11-16" });
    for (const f of plan.prune) expect(f).toMatch(/^auto-2026-0[78]-\d\d\.tar\.enc$/);
    expect(plan.prune).not.toContain("auto-2026-05-01.tar.enc");
    expect(plan.managed).not.toContain("auto-2026-05-02.tar.enc");
  });

  it("ignores archives dated in the future (clock trouble)", () => {
    const plan = planRetention(filesFor(["2026-11-15", "2027-01-01"]), { today: "2026-11-15" });
    expect(plan.managed).toEqual(["auto-2026-11-15.tar.enc"]);
  });
});
