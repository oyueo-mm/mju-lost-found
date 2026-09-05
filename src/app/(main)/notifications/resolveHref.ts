import { getChatRoomForUser, getMessage } from "@/lib/chat/service";
import { getOwnedPostRefForMatch } from "@/lib/match/service";

// Resolves a notification's relatedType/relatedId into a link to navigate
// to, when there's something to link to. Kept out of
// src/lib/notification/service.ts on purpose (Phase 9 spec section 16):
// that service has no dependency on the match or chat domains, and this
// function needs both -- so it lives here, one level up, imported by the
// page. Split into its own module (rather than inlined in page.tsx) so it
// can be unit-tested directly, same convention as this app's other
// route-local logic (see (auth)/onboarding/actions.ts + actions.test.ts).
//
// A missing/deleted related resource yields no link; the notification
// itself still renders normally either way -- this never throws.
export async function resolveHref(
  userId: number,
  relatedType: string | null,
  relatedId: number | null,
): Promise<string | null> {
  if (relatedId === null) return null;

  if (relatedType === "match") {
    const ref = await getOwnedPostRefForMatch(relatedId, userId);
    return ref ? `/post/${ref.id}?type=${ref.type}` : null;
  }

  if (relatedType === "message") {
    // Phase 11: relatedId here is a Message id (see chat/service.ts's
    // sendMessage(), never a ChatRoom id) -- resolve it to the room, then
    // re-derive real access through the *same* authorization
    // getChatRoomForUser() already enforces everywhere else in the chat
    // domain (see the Phase 11 report's "권한/보안 검증" section). This
    // is the security-relevant part: even a tampered/stale relatedId can
    // never produce a link into a room this user isn't actually a
    // participant of, because that check runs again here regardless of
    // what the notification claims.
    const message = await getMessage(relatedId);
    if (!message) return null; // message (and likely its notification) no longer exists
    const room = await getChatRoomForUser(message.chatRoomId, userId);
    return room.kind === "ok" ? `/chat/${room.data.id}` : null;
  }

  return null;
}
