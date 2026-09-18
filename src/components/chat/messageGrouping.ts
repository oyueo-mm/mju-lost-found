export type GroupableChatMessage = {
  senderUserId: number;
  createdAt: string;
};

export const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000;

export function isSameMessageGroup(previous: GroupableChatMessage | undefined, current: GroupableChatMessage): boolean {
  if (!previous || previous.senderUserId !== current.senderUserId) return false;

  const elapsed = new Date(current.createdAt).getTime() - new Date(previous.createdAt).getTime();
  return elapsed >= 0 && elapsed <= MESSAGE_GROUP_WINDOW_MS;
}

export function isSameCalendarDay(previous: GroupableChatMessage | undefined, current: GroupableChatMessage): boolean {
  if (!previous) return false;
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dateKey.format(new Date(previous.createdAt)) === dateKey.format(new Date(current.createdAt));
}
