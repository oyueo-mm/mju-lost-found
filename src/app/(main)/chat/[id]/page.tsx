import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireReadyUser } from "@/lib/auth/session";
import { getChatRoomForUser } from "@/lib/chat/service";
import { ChatThread } from "@/components/chat/ChatThread";
import { ReportButton } from "@/components/report/ReportButton";
import { AuthorLink } from "@/components/user/AuthorLink";
import { ImageOffIcon } from "@/components/icons";

export default async function ChatRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = await params;
  const user = await requireReadyUser("chat", `/chat/${idParam}`); // redirects to /login or /onboarding as needed

  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  // Access is re-verified against the DB here regardless of how this
  // page was reached -- a stranger who guesses/shares this URL can't see
  // into a room they aren't a participant of (see getChatRoomForUser).
  const result = await getChatRoomForUser(id, user.id);
  if (result.kind === "not_found") notFound();
  if (result.kind !== "ok") {
    return (
      <div className="rounded-card border border-destructive/30 bg-destructive-muted p-6 text-sm text-destructive">
        이 채팅방에 접근할 권한이 없어요.
      </div>
    );
  }

  const room = result.data;

  // Phase H-6: a "match" room always has both sides (분실물+습득물), a
  // "direct" room always has exactly one post -- same discriminated-union
  // shape resolveDetailDTO() in chat/service.ts already returns, just
  // normalized here into one array so the chip strip below doesn't need
  // its own roomType branch. `type` per ref is what makes each link land
  // on the correct board (/post/[id] requires it, LostPost/FoundPost ids
  // are independent sequences -- see post/[id]/page.tsx's own comment).
  const postRefs =
    room.roomType === "match"
      ? [
          { key: "lost", id: room.lostPost.id, type: "lost" as const, title: room.lostPost.title, imageUrl: room.lostPost.imageUrl },
          { key: "found", id: room.foundPost.id, type: "found" as const, title: room.foundPost.title, imageUrl: room.foundPost.imageUrl },
        ]
      : [{ key: "post", id: room.post.id, type: room.post.type, title: room.post.title, imageUrl: room.post.imageUrl }];

  return (
    // h-[70dvh], not h-[70vh]: `dvh` (dynamic viewport height) tracks the
    // browser's *actual* visible viewport, which shrinks when a mobile
    // on-screen keyboard opens or the browser chrome (address bar) hides/
    // shows -- plain `vh` stays pinned to the layout viewport and doesn't
    // adjust, which is what let the compose bar end up hidden behind the
    // keyboard on mobile. This bounded height is what gives ChatThread's
    // own flex column (see its own comment) a real height to fill and
    // scroll within -- no `position: fixed` needed.
    <div className="flex h-[70dvh] flex-col gap-3">
      <div className="flex items-center justify-between border-b border-border pb-3">
        {/* Phase H-7: "채팅 상대방 이름" -- same profile-link convention as
            PostCard/Post Detail/댓글. Not applied to the chat *list* page's
            rows (chat/page.tsx): each row there is already one whole-row
            <Link> to the room, and nesting a second link inside it would
            hit the same invalid-HTML/unreliable-click problem PostCard's
            own comment describes -- this room header isn't inside any
            other link, so no such conflict here. */}
        <AuthorLink
          nickname={room.counterpart.nickname}
          publicId={room.counterpart.publicId}
          className="font-semibold text-foreground hover:underline"
        />
        <div className="flex items-center gap-3">
          <ReportButton
            targetType="user"
            targetId={room.counterpart.id}
            buttonLabel={`${room.counterpart.nickname ?? "상대방"}님 신고하기`}
          />
          <Link href="/chat" className="text-sm text-muted-foreground underline hover:text-foreground">
            채팅 목록
          </Link>
        </div>
      </div>

      {/* Phase H-6 section 8: 게시글 -> 채팅 방향은 DirectChatButton/MatchPanel
          이 이미 처리하므로, 여기서는 채팅 -> 게시글 방향만 추가한다. 썸네일 +
          제목 + "게시글 보기"를 한 칩으로 묶어 클릭 시 정확히 해당 게시글
          상세로 이동한다 (match 방은 두 개, direct 방은 한 개). */}
      <div className="flex flex-wrap gap-2 border-b border-border pb-3">
        {postRefs.map((ref) => (
          <Link
            key={ref.key}
            href={`/post/${ref.id}?type=${ref.type}`}
            className="flex items-center gap-2 rounded-full border border-border bg-muted/50 py-1 pr-3 pl-1 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            <span className="relative size-6 shrink-0 overflow-hidden rounded-full bg-muted">
              {ref.imageUrl ? (
                <Image src={ref.imageUrl} alt={ref.title} fill sizes="24px" className="object-cover" />
              ) : (
                <ImageOffIcon className="m-auto size-3.5 text-muted-foreground" />
              )}
            </span>
            <span className="max-w-32 truncate">{ref.title}</span>
            <span className="font-medium text-primary">게시글 보기</span>
          </Link>
        ))}
      </div>

      <ChatThread chatRoomId={room.id} />
    </div>
  );
}
