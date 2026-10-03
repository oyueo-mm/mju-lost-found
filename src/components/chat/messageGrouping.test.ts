import { describe, expect, it } from "vitest";

import { isSameCalendarDay, isSameMessageGroup, MESSAGE_GROUP_WINDOW_MS, type GroupableChatMessage } from "./messageGrouping";

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

  // Regression (since 2cbdbc3): ChatThread passes messages[index + 1] as
  // `current` for the last message -- undefined -- which used to throw
  // "Cannot read properties of undefined (reading 'senderUserId')" and blank
  // every chat room that had at least one message.
  it("treats a missing message on either side as 'not the same group / day' instead of throwing", () => {
    expect(isSameMessageGroup(first, undefined)).toBe(false);
    expect(isSameMessageGroup(undefined, first)).toBe(false);
    expect(isSameMessageGroup(first, null)).toBe(false);
    expect(isSameMessageGroup(undefined, undefined)).toBe(false);
    expect(isSameCalendarDay(first, undefined)).toBe(false);
    expect(isSameCalendarDay(undefined, first)).toBe(false);
  });
});

// The exact per-message computation ChatThread's render loop does
// (messages.map((m, index) => ... messages[index - 1] / messages[index + 1] ...)).
function layout(messages: GroupableChatMessage[]) {
  return messages.map((m, index) => {
    const previousMessage = messages[index - 1];
    const nextMessage = messages[index + 1];
    return {
      groupStart: !isSameMessageGroup(previousMessage, m),
      groupEnd: !isSameMessageGroup(m, nextMessage),
      dateChanged: !isSameCalendarDay(previousMessage, m),
    };
  });
}

const at = (minute: number, senderUserId: number): GroupableChatMessage => ({
  senderUserId,
  createdAt: new Date(Date.UTC(2026, 9, 3, 1, minute)).toISOString(),
});

describe("chat thread layout over a whole room", () => {
  it("renders an empty room", () => {
    expect(layout([])).toEqual([]);
  });

  it("renders a room with one message: it both starts and ends its group", () => {
    expect(layout([at(0, 1)])).toEqual([{ groupStart: true, groupEnd: true, dateChanged: true }]);
  });

  it("groups a same-sender run and ends the group at the last message without throwing", () => {
    expect(layout([at(0, 1), at(1, 1), at(2, 1)])).toEqual([
      { groupStart: true, groupEnd: false, dateChanged: true },
      { groupStart: false, groupEnd: false, dateChanged: false },
      { groupStart: false, groupEnd: true, dateChanged: false },
    ]);
  });

  it("starts a new group whenever the sender changes", () => {
    expect(layout([at(0, 1), at(1, 2), at(2, 2), at(3, 1)])).toEqual([
      { groupStart: true, groupEnd: true, dateChanged: true },
      { groupStart: true, groupEnd: false, dateChanged: false },
      { groupStart: false, groupEnd: true, dateChanged: false },
      { groupStart: true, groupEnd: true, dateChanged: false },
    ]);
  });
});
