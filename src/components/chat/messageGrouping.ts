export type GroupableChatMessage = {
  senderUserId: number;
  createdAt: string;
};

export const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000;

// Either side may be missing: ChatThread asks about the message before the
// first one and the message after the last one (`messages[index ± 1]`), and
// neither exists -- that's simply "not the same group", never an error.
type MaybeMessage = GroupableChatMessage | null | undefined;

export function isSameMessageGroup(previous: MaybeMessage, current: MaybeMessage): boolean {
  if (!previous || !current || previous.senderUserId !== current.senderUserId) return false;

  const elapsed = new Date(current.createdAt).getTime() - new Date(previous.createdAt).getTime();
  return elapsed >= 0 && elapsed <= MESSAGE_GROUP_WINDOW_MS;
}

export function isSameCalendarDay(previous: MaybeMessage, current: MaybeMessage): boolean {
  if (!previous || !current) return false;
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dateKey.format(new Date(previous.createdAt)) === dateKey.format(new Date(current.createdAt));
}
