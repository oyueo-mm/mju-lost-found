// 감사 쪽지: who may thank whom. Pure, so the rules are tested without a
// database (service.ts loads the inputs and re-checks them on every write).
//
// A note thanks one recorded return (PostReturn): the author marked the post
// done from a chat room, which made that room's other person the return
// partner. Only the one who got the item back (the return's owner) may
// thank, and only the one who returned it (its finder) receives -- never
// derived from who pressed 찾음 완료, never chosen by the client. A post
// completed from its own page has no return, so nobody gets to thank
// automatically. Completion is the poster's own mark, not a verified
// hand-over, so a note never says one was verified.
//
// Also required: the post is still done and the return still active, both
// people wrote in the linked room, neither account is suspended or
// withdrawn, and the owner has not thanked for this post yet.

export const THANK_NOTE_MAX_LENGTH = 500;
export const THANK_NOTES_PER_DAY = 5;

export type ThankReturn = { id: number; chatRoomId: number | null; ownerUserId: number; finderUserId: number; revoked: boolean };
export type ThankContext = {
  completed: boolean;
  ret: ThankReturn | null;
  // users who sent at least one message in the return's room
  writers: number[];
  unavailable: Set<number>;
  alreadySent: boolean;
};
export type ThankTarget = { receiverId: number; chatRoomId: number; returnId: number };

export function thankTarget(viewerId: number, ctx: ThankContext): ThankTarget | null {
  const r = ctx.ret;
  if (!ctx.completed || !r || r.revoked || r.chatRoomId === null || ctx.alreadySent) return null;
  if (r.ownerUserId !== viewerId || r.finderUserId === viewerId) return null;
  if (ctx.unavailable.has(viewerId) || ctx.unavailable.has(r.finderUserId)) return null;
  if (!ctx.writers.includes(viewerId) || !ctx.writers.includes(r.finderUserId)) return null;
  return { receiverId: r.finderUserId, chatRoomId: r.chatRoomId, returnId: r.id };
}

// 칭찬 태그 (Phase 3-B): exactly these five, in this order; any number may
// be picked, none is fine. Stored as these codes (the DB CHECK allows only
// them); labels live in the dictionaries (thanks.tag.<code>).
export const THANK_TAGS = ["kind", "quick_reply", "kept_well", "helpful", "kept_promise"] as const;
export type ThankTag = (typeof THANK_TAGS)[number];

// A 감사 후기 needs the message or at least one tag (an empty review is not
// sent); the message alone or the tags alone are both fine. Unknown or
// repeated tags are dropped, the rest kept in THANK_TAGS order.
export type ThankInputResult = { ok: true; body: string; tags: ThankTag[] } | { ok: false; error: "empty" | "too_long" };
export function validateThankInput(raw: { body: unknown; tags?: unknown }): ThankInputResult {
  const body = typeof raw.body === "string" ? raw.body.replace(/\r\n/g, "\n").trim() : "";
  const picked = Array.isArray(raw.tags) ? raw.tags : [];
  const tags = THANK_TAGS.filter((t) => picked.includes(t));
  if (!body && tags.length === 0) return { ok: false, error: "empty" };
  if ([...body].length > THANK_NOTE_MAX_LENGTH) return { ok: false, error: "too_long" };
  return { ok: true, body, tags };
}

export type ThankBodyResult = { ok: true; body: string } | { ok: false; error: "empty" | "too_long" };
export function validateThankBody(raw: unknown): ThankBodyResult {
  const body = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim() : "";
  if (!body) return { ok: false, error: "empty" };
  if ([...body].length > THANK_NOTE_MAX_LENGTH) return { ok: false, error: "too_long" };
  return { ok: true, body };
}

// A published note is readable by anyone, so a note that looks like it
// carries contact or ID details (phone, e-mail, 학번 / 주민번호-like digit
// runs, kakao/insta IDs) is kept private: it can be read by its receiver but
// not published. A heuristic, not a guarantee -- the sender is also asked not
// to write such details.
const PERSONAL_PATTERNS: RegExp[] = [
  /01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/, // mobile phone
  /0\d{1,2}[-.\s]\d{3,4}[-.\s]\d{4}/, // landline
  /[\w.+-]+@[\w-]+\.[\w.-]+/, // e-mail
  /\d{6}[-\s]?[1-8]\d{6}/, // 주민등록번호-like
  /(?<!\d)\d{8,}(?!\d)/, // 학번 / account-like digit run
  /(카톡|카카오톡|오픈채팅|인스타|instagram|insta)\s*(아이디|id)?\s*[:：]?\s*[@\w.]{3,}/i,
];
export function looksPersonal(body: string): boolean {
  return PERSONAL_PATTERNS.some((re) => re.test(body));
}
