import { describe, expect, it } from "vitest";

import { isSameCalendarDay, isSameMessageGroup, MESSAGE_GROUP_WINDOW_MS } from "./messageGrouping";

const first = { senderUserId: 1, createdAt: "2026-09-18T09:00:00.000Z" };

describe("chat message grouping", () => {
  it("groups consecutive messages from the same sender within five minutes", () => {
    expect(isSameMessageGroup(first, { ...first, createdAt: "2026-09-18T09:05:00.000Z" })).toBe(true);
    expect(MESSAGE_GROUP_WINDOW_MS).toBe(300_000);
  });

  it("starts a new group when the sender changes or the interval is longer", () => {
    expect(isSameMessageGroup(first, { senderUserId: 2, createdAt: "2026-09-18T09:01:00.000Z" })).toBe(false);
    expect(isSameMessageGroup(first, { ...first, createdAt: "2026-09-18T09:05:00.001Z" })).toBe(false);
  });

  it("detects date boundaries independently from message grouping", () => {
    expect(isSameCalendarDay(first, { ...first, createdAt: "2026-09-18T14:00:00.000Z" })).toBe(true);
    expect(isSameCalendarDay(first, { ...first, createdAt: "2026-09-19T09:00:00.000Z" })).toBe(false);
  });
});
