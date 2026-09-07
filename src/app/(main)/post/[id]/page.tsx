import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { getFoundPost, getLostPost } from "@/lib/posts/service";
import { FOUND_STATUSES, LOST_STATUSES, postTypeSchema } from "@/lib/posts/schema";
import { isAdmin } from "@/lib/moderation/service";
import { listCommentsForPost } from "@/lib/comment/service";
import { PostManageMenu } from "@/components/post/PostManageMenu";
import { ViewTracker } from "@/components/post/ViewTracker";
import { ImageSimilaritySection } from "@/components/post/ImageSimilaritySection";
import { DirectChatButton } from "@/components/chat/DirectChatButton";
import { listMatchesForPost } from "@/lib/match/service";
import { MatchPanel } from "@/components/match/MatchPanel";
import { CommentSection } from "@/components/comment/CommentSection";
import { encodePostTargetId } from "@/lib/report/targets";
import { ReportButton } from "@/components/report/ReportButton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ImageOffIcon, PinIcon, ClockIcon, EyeIcon } from "@/components/icons";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default async function PostDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { id: idParam } = await params;
  const { type: typeParam } = await searchParams;

  // LostPost/FoundPost ids are independent sequences (see schema.prisma),
  // so the same numeric id can exist in both tables -- `type` is required
  // to know which one this link actually means, never guessed.
  const id = Number(idParam);
  const typeResult = postTypeSchema.safeParse(typeParam);
  if (!Number.isInteger(id) || !typeResult.success) notFound();
  const type = typeResult.data;

  // Phase 24-2-2: getCurrentUser() doesn't read anything derived from the
  // post (it only needs the request's own session), so it never had to
  // wait on getLostPost/getFoundPost -- running them concurrently instead
  // of sequentially removes one full DB round trip from the critical
  // path. (One side effect worth naming: getCurrentUser() now also runs
  // on a subsequently-404'd id/type, which it didn't before -- its result
  // is never used on that path either way, so this changes nothing about
  // what the viewer sees.)
  const [post, currentUser] = await Promise.all([
    type === "lost" ? getLostPost(id) : getFoundPost(id),
    getCurrentUser(),
  ]);
  if (!post) notFound();

  const isOwner = currentUser?.id === post.author.id;
  const viewerIsAdmin = currentUser ? isAdmin(currentUser) : false;
  const dateLabel = post.type === "lost" ? "분실 일시" : "습득 일시";
  const dateValue = post.type === "lost" ? post.lostAt : post.foundAt;

  // Phase 23: plain Prisma reads (comments, view count already on `post`)
  // -- neither is AI work, so both stay in this page's normal server
  // render rather than being deferred like matching candidates are (see
  // MatchPanel's own comment for why *that* one specifically moved behind
  // a button click).
  //
  // Phase 24-2-2: comments and (owner-only) match data don't depend on
  // each other -- only on `post`/`isOwner`, both already resolved above --
  // so their two DB round trips run concurrently instead of one after the
  // other. Each keeps its own try/catch exactly as before (a comments
  // failure still can't affect match-loading and vice versa); only the
  // *waiting* is now shared.
  async function loadComments(): Promise<Awaited<ReturnType<typeof listCommentsForPost>>> {
    try {
      return await listCommentsForPost(type, post!.id);
    } catch (error) {
      console.error("Failed to load comments", error);
      return [];
    }
  }

  // Match UI only ever needs to appear on a post the viewer owns (see
  // MatchPanel's comment) -- so existing-match data is only fetched at
  // all when isOwner, and a failure here shows a small inline notice
  // rather than breaking the rest of the (already-successful) page. AI
  // candidates are fetched client-side by MatchPanel itself (GET
  // /api/posts/[id]/matches/candidates), not here.
  async function loadMatchPanelData(): Promise<{
    matchPanelData: {
      matches: { id: number; counterpart: { id: number; title: string; imageUrl: string | null } }[];
    } | null;
    matchLoadError: boolean;
  }> {
    if (!isOwner) return { matchPanelData: null, matchLoadError: false };
    try {
      const matchResult = await listMatchesForPost(type, post!.id, currentUser!.id);
      const matches =
        matchResult.kind === "ok"
          ? matchResult.data.map((m) => ({
              id: m.id,
              counterpart: type === "lost" ? m.foundPost : m.lostPost,
            }))
          : [];
      return { matchPanelData: { matches }, matchLoadError: false };
    } catch (error) {
      console.error("Failed to load match data", error);
      return { matchPanelData: null, matchLoadError: true };
    }
  }

  const [comments, { matchPanelData, matchLoadError }] = await Promise.all([
    loadComments(),
    loadMatchPanelData(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <ViewTracker type={type} postId={post.id} />
      {post.imageUrl ? (
        // Phase H-3's `width/height` hint + `h-auto w-auto` pattern never
        // upscales past the source photo's own pixel resolution (that's
        // what `h-auto w-auto` is *for* -- it makes Next.js size the <img>
        // from the loaded file's real intrinsic dimensions), which is why
        // images "felt small" on a wide desktop column: a modest phone
        // photo simply never grew to fill the space. `fill` inside an
        // explicitly height-bounded box (`h-[45vh] md:h-[65vh]`, capped
        // rather than open-ended so a very tall portrait still can't
        // dominate the whole page) plus `object-contain` (never `-cover`)
        // is the one combination that satisfies all of: genuinely larger
        // on both mobile and desktop, uses the full available width,
        // never crops, and never distorts a portrait or landscape photo
        // -- any letterboxed leftover space uses the same neutral
        // `bg-muted` tone as PostCard's own no-image placeholder instead
        // of bare white/black.
        <div className="relative h-[45vh] w-full overflow-hidden rounded-card border border-border bg-muted md:h-[65vh]">
          <Image
            src={post.imageUrl}
            alt={post.title}
            fill
            sizes="(min-width: 768px) 768px, 100vw"
            className="object-contain"
            priority
          />
        </div>
      ) : (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-card border border-dashed border-border text-sm text-muted-foreground">
          <ImageOffIcon className="size-7" />
          등록된 이미지가 없습니다.
        </div>
      )}

      {/* Phase H-3: title/status/장소/날짜/카테고리/조회수/설명 -- one card so
          the reader's eye has a single, clearly-bounded "이 게시물의 핵심
          정보" region instead of the info trailing off into plain page
          background.
          Phase H-6: author nickname now sits directly above the title
          (largest single signal for "누가 올린 글인지") instead of buried in
          a separate box below; title+status stayed the single most
          prominent line and only grew (text-2xl on desktop). 작성일/수정일
          shrank to one small caption line at the very bottom of the same
          card -- still present, still unaltered data, just no longer
          competing for attention with title/status/description. Edit/
          delete/상태변경 collapsed into PostManageMenu's "⋯" trigger next to
          the status badge (owner-only, same as the controls it replaces).
          No field removed or renamed, only regrouped; StatusBadge/PinIcon/
          ClockIcon/EyeIcon usages are unchanged. */}
      <div className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-sm font-medium text-primary">
              {post.author.nickname ?? "알 수 없음"}
            </span>
            <h1 className="text-xl font-semibold text-foreground md:text-2xl">{post.title}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <StatusBadge status={post.status} />
            {isOwner && (
              <PostManageMenu
                id={post.id}
                type={type}
                currentStatus={post.status}
                statuses={type === "lost" ? LOST_STATUSES : FOUND_STATUSES}
              />
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground">
            {type === "lost" ? "분실물" : "습득물"}
          </span>
          <span>{post.category}</span>
          <span className="rounded-full bg-primary-muted px-2.5 py-0.5 text-xs font-medium text-primary">
            {post.campus}
          </span>
          <span className="flex items-center gap-1">
            <PinIcon className="size-3.5" />
            {post.location}
          </span>
          <span className="flex items-center gap-1">
            <ClockIcon className="size-3.5" />
            {dateLabel}: {formatDate(dateValue)}
          </span>
          <span className="flex items-center gap-1">
            <EyeIcon className="size-3.5" />
            {post.viewCount}
          </span>
        </div>
        <p className="whitespace-pre-wrap border-t border-border pt-4 text-sm leading-relaxed text-foreground">
          {post.description}
        </p>
        <p className="text-xs text-muted-foreground/70">
          작성일 {formatDate(post.createdAt)} · 수정일 {formatDate(post.updatedAt)}
        </p>
      </div>

      {/* Phase 10: direct-chat entry point -- only a non-owner can message
          the author this way (no Match required); the owner never sees
          this (mirrors legacy pages/1,2, which only render the button on
          someone else's post). Phase 14: a logged-out visitor now sees the
          same entry point too, styled identically, but as a plain link
          into /login (reason=chat, callbackUrl back to this post) instead
          of the real chat-starting button -- rather than the button being
          silently absent with no explanation. The API re-checks
          ownership/suspension/post-existence regardless
          (getOrCreateDirectChatRoom); this is UI guidance only. */}
      {!isOwner &&
        (currentUser ? (
          <DirectChatButton postType={type} postId={post.id} />
        ) : (
          <Link
            href={`/login?reason=chat&callbackUrl=${encodeURIComponent(`/post/${post.id}?type=${type}`)}`}
            className="w-fit rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:border-foreground/30"
          >
            채팅하기
          </Link>
        ))}

      {currentUser && (
        <ReportButton targetType="post" targetId={encodePostTargetId(type, post.id)} />
      )}

      {isOwner &&
        (matchLoadError ? (
          <div className="rounded-card border border-destructive/30 bg-destructive-muted p-4 text-sm text-destructive">
            매칭 정보를 불러오는 중 문제가 발생했습니다.
          </div>
        ) : (
          matchPanelData && (
            <MatchPanel postType={type} postId={post.id} initialMatches={matchPanelData.matches} />
          )
        ))}

      {/* Phase 15-2 feature, moved behind a button click (this phase): only
          rendered at all when there's an image to search against -- an
          image-less post has nothing for this to find, same as before.
          AI logic/accuracy unchanged, only *when* it runs (see
          ImageSimilaritySection's own comment). */}
      {post.imageUrl && <ImageSimilaritySection postType={type} postId={post.id} />}

      <CommentSection
        postType={type}
        postId={post.id}
        initialComments={comments}
        currentUser={currentUser ? { id: currentUser.id } : null}
        isAdmin={viewerIsAdmin}
      />
    </div>
  );
}
