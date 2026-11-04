import { FallbackImage } from "@/components/ui/FallbackImage";
import Link from "next/link";
import { notFound } from "next/navigation";

import { identityFormUrl, requireReadyUser } from "@/lib/auth/session";
import { hasIdentityInfo } from "@/lib/identity/service";
import { LinkButton } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getChatRoomForUser, listChatRoomsForUser } from "@/lib/chat/service";
import { ChatThread, type ChatTimelineCard } from "@/components/chat/ChatThread";
import { ChatReturnPanel } from "@/components/chat/ChatReturnPanel";
import { ChatRoomList } from "@/components/chat/ChatRoomList";
import { ChatShell } from "@/components/chat/ChatShell";
import { ReturnCompletedCard } from "@/components/chat/ReturnCompletedCard";
import { ThankNoteCard } from "@/components/thanks/ThankNoteCard";
import { canCompleteFromChat, chatRoomPostState, roomStatusEvents } from "@/lib/posts/returns";
import { thankComposerForRoom, thankNotesForRoom } from "@/lib/thanks/service";
import { prisma } from "@/lib/db/prisma";
import { pushConfig } from "@/lib/push/service";
import { ReportButton } from "@/components/report/ReportButton";
import { AuthorLink } from "@/components/user/AuthorLink";
import { ChevronLeftIcon, ImageOffIcon, ShieldIcon } from "@/components/icons";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { LOCALE_INTL_TAG } from "@/lib/i18n/config";
import { postTypeLabelKey } from "@/lib/i18n/labels";

// 채팅방 (Phase 3-B). Header: the other person (profile link, 신고) and the
// post as one small row -- photo, 분실물/습득물, its status, title, 게시글
// 보기. Then, for the post's author before completion, the 찾음 완료 card;
// then the conversation, where the 반환 완료 card and the 감사 후기 cards sit
// between the messages by time. From lg the room list stays on the left.
// Who may complete, who may thank whom and who sees which note are all
// decided on the server (lib/posts/returns, lib/thanks), unchanged.
export default async function ChatRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const [t, locale] = await Promise.all([getTranslator(), getLocale()]);
  const { id: idParam } = await params;
  const user = await requireReadyUser("chat", `/chat/${idParam}`); // redirects to /login or /onboarding as needed

  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  const result = await getChatRoomForUser(id, user.id);
  if (result.kind === "not_found") notFound();
  if (result.kind !== "ok") {
    return <div className="rounded-card border border-destructive/30 bg-destructive-muted p-6 text-sm text-destructive">{t("chat.accessDenied")}</div>;
  }

  const room = result.data;
  const postDeleted = room.post.deleted;
  const fmt = (d: Date) => new Intl.DateTimeFormat(LOCALE_INTL_TAG[locale], { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(d);

  const [identityReady, rooms] = await Promise.all([
    hasIdentityInfo(user.id),
    listChatRoomsForUser(user.id).catch((error) => {
      console.error("Failed to load chat rooms beside the room", error);
      return [];
    }),
  ]);

  const returnState = await (async () => {
    try {
      const state = postDeleted ? null : await chatRoomPostState(prisma, room.id, user.id);
      if (!state) return null;
      const partner = state.partnerId === null ? null : await prisma.user.findUnique({ where: { id: state.partnerId }, select: { withdrawnAt: true } });
      const [thank, events, ret, notes] = await Promise.all([
        thankComposerForRoom(user.id, room.id),
        roomStatusEvents(state.postType, state.postId),
        prisma.postReturn.findFirst({ where: { postType: state.postType, postId: state.postId, revokedAt: null }, orderBy: { id: "desc" }, select: { id: true, chatRoomId: true, createdAt: true } }),
        thankNotesForRoom(user.id, room.id),
      ]);
      return {
        postType: state.postType,
        canComplete: canCompleteFromChat(state, user.id) && !!partner && partner.withdrawnAt === null,
        // the return was recorded in this very room (not another room of the post)
        returnHere: state.completed && ret?.chatRoomId === room.id ? ret : null,
        thank,
        events,
        notes,
      };
    } catch (error) {
      console.error("Failed to load the room's return state", error);
      return null;
    }
  })();

  // The 반환 완료 card replaces this room's own "completed" status line (the
  // latest one); every other status line stays as it was.
  const lastCompleted = returnState?.returnHere ? [...returnState.events].reverse().find((e) => e.kind === "completed") : undefined;
  const statusEvents = (returnState?.events ?? []).filter((e) => e !== lastCompleted);
  const timelineCards: ChatTimelineCard[] = [];
  if (returnState?.returnHere) {
    const r = returnState.returnHere;
    const thank = returnState.thank && !returnState.thank.alreadySent ? returnState.thank : null;
    timelineCards.push({
      key: `return-${r.id}`,
      at: (lastCompleted ? new Date(lastCompleted.at) : r.createdAt).toISOString(),
      node: (
        <ReturnCompletedCard
          time={fmt(r.createdAt)}
          returnId={r.id}
          thank={thank && { postType: thank.postType, postId: thank.postId, receiverName: thank.receiver?.nickname ?? null, postTitle: room.post.title, postImageUrl: room.post.imageUrl }}
        />
      ),
    });
  }
  for (const note of returnState?.notes ?? []) {
    timelineCards.push({ key: `thank-${note.id}`, at: note.createdAt.toISOString(), node: <ThankNoteCard note={note} time={fmt(note.createdAt)} /> });
  }

  const postStatus = room.post.type === "lost" ? (room.post.completed ? "찾음" : "찾는 중") : room.post.completed ? "완료" : "보관 중";

  const roomView = (
    <div className="flex h-[70dvh] min-h-0 flex-col gap-3 lg:h-full">
      <header className="flex shrink-0 flex-col gap-2.5 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <Link href="/chat" aria-label={t("chat.backToList")} className="-ml-2 flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden">
            <ChevronLeftIcon aria-hidden="true" className="size-5" />
          </Link>
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Phase 12-11: an organization room shows the organization (never
                a manager's own identity); a manager viewing someone else's
                inquiry also sees who opened it. */}
            {room.counterpart.kind === "organization" ? (
              <>
                <Link href={`/organizations/${room.counterpart.id}`} className="flex w-fit max-w-full items-center gap-1.5 truncate font-semibold text-foreground hover:underline">
                  <ShieldIcon className="size-4 shrink-0 text-primary" />
                  <span className="truncate">{room.counterpart.name}</span>
                </Link>
                {room.inquirer && room.inquirer.id !== user.id && (
                  <span className="truncate text-xs text-muted-foreground">{t("chat.inquirer", { name: room.inquirer.nickname ?? t("common.unknown") })}</span>
                )}
              </>
            ) : (
              <AuthorLink
                nickname={room.counterpart.nickname}
                publicId={room.counterpart.publicId}
                userType={room.counterpart.userType}
                className="w-fit max-w-full truncate font-semibold text-foreground hover:underline"
              />
            )}
          </div>
          {/* Phase 12-11: only a person can be reported, never an organization */}
          {room.counterpart.kind === "user" && (
            <ReportButton
              targetType="user"
              targetId={room.counterpart.id}
              buttonLabel={t("chat.reportUser", { name: room.counterpart.nickname ?? t("chat.counterpart") })}
              triggerClassName="flex h-9 shrink-0 items-center rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            />
          )}
        </div>

        {/* The post this chat is about. A deleted post keeps its title, with
            nothing to link to. */}
        {postDeleted ? (
          <span className="flex items-center gap-2.5 rounded-lg bg-muted/60 p-2 text-xs text-muted-foreground">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
              <ImageOffIcon className="size-4" />
            </span>
            <span className="min-w-0 truncate">
              {t("chat.deletedPost")} · {room.post.title}
            </span>
          </span>
        ) : (
          <Link
            href={`/post/${room.post.id}?type=${room.post.type}`}
            className="group flex items-center gap-2.5 rounded-lg bg-muted/60 p-2 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
              {room.post.imageUrl ? (
                <FallbackImage src={room.post.imageUrl} alt="" fill sizes="40px" className="object-cover" fallback={<ImageOffIcon className="size-4" />} />
              ) : (
                <ImageOffIcon aria-hidden="true" className="size-4" />
              )}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>{t(postTypeLabelKey(room.post.type))}</span>
                <StatusBadge status={postStatus} compact />
              </span>
              <span className="truncate text-sm font-medium text-foreground">{room.post.title}</span>
            </span>
            <span className="shrink-0 text-xs font-medium text-primary">{t("chat.viewPost")}</span>
          </Link>
        )}
      </header>

      {returnState?.canComplete && <ChatReturnPanel chatRoomId={room.id} postType={returnState.postType} />}

      <ChatThread
        chatRoomId={room.id}
        currentUserId={user.id}
        statusEvents={statusEvents}
        timelineCards={timelineCards}
        trackPresence={pushConfig() !== null}
        sendBlockedNotice={
          identityReady ? undefined : (
            <div className="flex flex-col gap-2 rounded-card border border-primary/30 bg-primary-muted px-4 py-3 text-sm text-primary sm:flex-row sm:items-center sm:justify-between">
              <p>{t("identity.chatBlocked")}</p>
              <LinkButton href={identityFormUrl(`/chat/${room.id}`)} size="sm" className="w-full sm:w-auto">
                {t("identity.goToForm")}
              </LinkButton>
            </div>
          )
        }
      />
    </div>
  );

  return <ChatShell title={t("chat.title")} list={<ChatRoomList rooms={rooms} viewerId={user.id} activeId={room.id} />} main={roomView} />;
}
