import { beforeEach, describe, expect, it, vi } from "vitest";

// Rows written before the event-time role snapshot (activity_audience NULL)
// must never be dropped from statistics just for lacking the stored mark.
const marks: { day: string; actor: string; audience: string | null; role: string | null; org: number | null }[] = [];
let resolved: Record<number, string> = {};
const queries: string[] = [];
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: { findMany: async () => [{ id: 1 }, { id: 2 }, { id: 3 }] },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      queries.push(sql);
      if (sql.includes('FROM "ActivityDay"')) return marks;
      if (sql.includes("mju_legacy_day_audience")) return (values[0] as number[]).map((id, i) => ({ i: i + 1, a: resolved[id] }));
      throw new Error(`unexpected ${sql}`);
    },
  },
}));
const { audienceSql, roleSql, signupAudienceSql, tableAudienceSql, tableRoleSql, loadClassifiedMarks } = await import("./legacyAudience");
const { activityActor } = await import("./record");

beforeEach(() => { marks.length = 0; resolved = {}; queries.length = 0; });

describe("SQL: the stored snapshot first, the admin-history classification only for unstamped rows", () => {
  it("uses the stored value when there is one (COALESCE), so stamped rows never change", () => {
    expect(audienceSql("user_id").sql).toBe(`COALESCE("activity_audience", mju_legacy_audience("user_id", "created_at"))`);
    expect(roleSql("admin_user_id", undefined, "started_at").sql).toBe(`COALESCE("activity_role", mju_legacy_role("admin_user_id", "started_at"))`);
    expect(signupAudienceSql("u").sql).toBe(`COALESCE(u."activity_audience", mju_legacy_signup_audience(u."id"))`);
  });
  it("knows each event table's actor column", () => {
    expect(tableAudienceSql("LostPost").sql).toContain(`"user_id"`);
    expect(tableAudienceSql("Message", "m").sql).toContain(`m."sender_user_id"`);
    expect(tableAudienceSql("PostStatusChange").sql).toContain(`"changed_by_user_id"`);
    expect(tableAudienceSql("User").sql).toContain("mju_legacy_signup_audience");
    // a sign-up is never management activity
    expect(tableRoleSql("User").sql).toContain("WHEN 'member' THEN 'member' ELSE 'unclassified'");
  });
});

describe("ActivityDay marks", () => {
  it("keeps stamped marks as stored and asks the DB only about unstamped ones", async () => {
    marks.push({ day: "2026-11-04", actor: activityActor(1), audience: "member", role: "member", org: null });
    const out = await loadClassifiedMarks({ from: "2026-11-04", until: "2026-11-05" });
    expect(out).toEqual([{ day: "2026-11-04", actor: activityActor(1), audience: "member", role: "member", organizationId: null }]);
    expect(queries.some((q) => q.includes("mju_legacy_day_audience"))).toBe(false);
  });
  it("links an unstamped mark back to its account and classifies it for that day", async () => {
    marks.push(
      { day: "2026-10-16", actor: activityActor(1), audience: null, role: null, org: null },
      { day: "2026-10-16", actor: activityActor(2), audience: null, role: null, org: null },
      { day: "2026-10-15", actor: activityActor(3), audience: null, role: null, org: null },
    );
    resolved = { 1: "member", 2: "internal", 3: "unclassified" };
    const out = await loadClassifiedMarks({ days: ["2026-10-15", "2026-10-16"] });
    expect(out.map((m) => [m.audience, m.role])).toEqual([["member", "member"], ["internal", "service"], ["unclassified", null]]);
  });
  it("leaves a mark matching no account unclassified (never a member, never dropped silently)", async () => {
    marks.push({ day: "2026-10-16", actor: "no-such-account-hmac", audience: null, role: null, org: null });
    const out = await loadClassifiedMarks({ from: "2026-10-16", until: "2026-10-17" });
    expect(out).toEqual([expect.objectContaining({ audience: "unclassified" })]);
  });
});
