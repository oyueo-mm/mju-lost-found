// 감사 쪽지: who may thank whom for a post. Pure, so the rules are tested
// without a database (service.ts loads the inputs and re-checks them on
// every write).
//
// A note needs a real connection made through the service, not a proof of
// hand-over -- completion is only the poster's own mark:
//   * the post is marked done (분실물 찾음 / 습득물 완료);
//   * a direct 1:1 chat room about this post exists in which BOTH people
//     wrote at least one message (an organization room has no single person
//     to thank and is left out);
//   * the sender is the one who got the item back: on a lost post its author,
//     on a found post the other person in the room (the author is the finder);
//   * never oneself, never a suspended or withdrawn account, once per post.

export const THANK_NOTE_MAX_LENGTH = 500;
export const THANK_NOTES_PER_DAY = 5;

export type ThankRoom = {
  id: number;
  initiatorUserId: number | null;
  counterpartUserId: number | null;
  organizationId: number | null;
  // users who sent at least one message in the room
  writers: number[];
};
export type ThankPost = { type: "lost" | "found"; authorId: number; completed: boolean };
export type ThankCandidate = { receiverId: number; chatRoomId: number };

export function thankCandidates(
  post: ThankPost,
  viewerId: number,
  rooms: ThankRoom[],
  { unavailable = new Set<number>(), alreadySent = false }: { unavailable?: Set<number>; alreadySent?: boolean } = {},
): ThankCandidate[] {
  if (!post.completed || alreadySent || unavailable.has(viewerId)) return [];
  const out = new Map<number, ThankCandidate>();
  for (const room of rooms) {
    if (room.organizationId !== null || room.initiatorUserId === null || room.counterpartUserId === null) continue;
    const people = [room.initiatorUserId, room.counterpartUserId];
    if (!people.includes(viewerId)) continue;
    const other = people.find((id) => id !== viewerId);
    if (other === undefined || other === viewerId) continue;
    // both sides wrote in this room
    if (!room.writers.includes(viewerId) || !room.writers.includes(other)) continue;
    // lost: the author (owner) thanks the finder; found: the owner thanks the author (finder)
    const viewerIsAuthor = viewerId === post.authorId;
    if (post.type === "lost" ? !viewerIsAuthor : viewerIsAuthor || other !== post.authorId) continue;
    if (unavailable.has(other)) continue;
    if (!out.has(other)) out.set(other, { receiverId: other, chatRoomId: room.id });
  }
  return [...out.values()];
}

export type ThankBodyResult = { ok: true; body: string } | { ok: false; error: string };
export function validateThankBody(raw: unknown): ThankBodyResult {
  const body = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim() : "";
  if (!body) return { ok: false, error: "감사 인사를 적어 주세요." };
  if ([...body].length > THANK_NOTE_MAX_LENGTH) return { ok: false, error: `${THANK_NOTE_MAX_LENGTH}자 이내로 적어 주세요.` };
  return { ok: true, body };
}
