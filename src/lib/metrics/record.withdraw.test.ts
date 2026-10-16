import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

const { activityActor, deleteActivityMarks } = await import("./record");

// An in-memory ActivityDay: deleteMany removes exactly the rows whose actor
// is in the list, like Prisma's { actor: { in } }.
function table(rows: { day: string; actor: string }[]) {
  const calls: string[][] = [];
  return {
    rows,
    calls,
    activityDay: {
      async deleteMany({ where }: { where: { actor: { in: string[] } } }) {
        calls.push(where.actor.in);
        const before = rows.length;
        rows.splice(0, rows.length, ...rows.filter((r) => !where.actor.in.includes(r.actor)));
        return { count: before - rows.length };
      },
    },
  };
}

describe("deleteActivityMarks (회원탈퇴)", () => {
  it("deletes only the given member's marks, matched by their HMAC", async () => {
    const db = table([
      { day: "2026-10-15", actor: activityActor(7) },
      { day: "2026-10-16", actor: activityActor(7) },
      { day: "2026-10-16", actor: activityActor(70) }, // another member, similar id
      { day: "2026-10-16", actor: activityActor(8) },
      { day: "2026-10-16", actor: "made-under-another-key" }, // matches no one: left for the 400-day clean-up
    ]);
    expect(await deleteActivityMarks(db, [7])).toBe(2);
    expect(db.rows.map((r) => r.actor)).toEqual([activityActor(70), activityActor(8), "made-under-another-key"]);
    expect(db.calls).toEqual([[activityActor(7)]]);
  });

  it("never matches across members or keys", () => {
    const ids = Array.from({ length: 2000 }, (_, i) => i + 1);
    expect(new Set(ids.map((id) => activityActor(id))).size).toBe(ids.length);
    expect(activityActor(7, "key-a")).not.toBe(activityActor(7, "key-b"));
  });

  it("does nothing for no ids, and batches a long list", async () => {
    const empty = table([{ day: "2026-10-16", actor: activityActor(1) }]);
    expect(await deleteActivityMarks(empty, [])).toBe(0);
    expect(empty.calls).toEqual([]);
    expect(empty.rows).toHaveLength(1);

    const ids = Array.from({ length: 1200 }, (_, i) => i + 1);
    const many = table(ids.map((id) => ({ day: "2026-10-16", actor: activityActor(id) })).concat({ day: "2026-10-16", actor: activityActor(5000) }));
    expect(await deleteActivityMarks(many, [...ids, 3, 3])).toBe(1200);
    expect(many.calls.map((c) => c.length)).toEqual([500, 500, 200]);
    expect(many.rows.map((r) => r.actor)).toEqual([activityActor(5000)]);
  });
});
