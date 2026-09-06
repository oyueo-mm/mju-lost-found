import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { getFoundPost, getLostPost } from "@/lib/posts/service";
import { FOUND_STATUSES, LOST_STATUSES, postTypeSchema } from "@/lib/posts/schema";
import { isAdmin } from "@/lib/moderation/service";
import { listCommentsForPost } from "@/lib/comment/service";
import { DeletePostButton } from "@/components/post/DeletePostButton";
import { StatusChangeControl } from "@/components/post/StatusChangeControl";
import { ViewTracker } from "@/components/post/ViewTracker";
import { ImageSimilaritySection } from "@/components/post/ImageSimilaritySection";
import { DirectChatButton } from "@/components/chat/DirectChatButton";
import { listMatchesForPost } from "@/lib/match/service";
import { MatchPanel } from "@/components/match/MatchPanel";
import { CommentSection } from "@/components/comment/CommentSection";
import { encodePostTargetId } from "@/lib/report/targets";
import { ReportButton } from "@/components/report/ReportButton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { LinkButton } from "@/components/ui/Button";
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

  const post = type === "lost" ? await getLostPost(id) : await getFoundPost(id);
  if (!post) notFound();

  const currentUser = await getCurrentUser();
  const isOwner = currentUser?.id === post.author.id;
  const viewerIsAdmin = currentUser ? isAdmin(currentUser) : false;
  const dateLabel = post.type === "lost" ? "분실 일시" : "습득 일시";
  const dateValue = post.type === "lost" ? post.lostAt : post.foundAt;

  // Phase 23: plain Prisma reads (comments, view count already on `post`)
  // -- neither is AI work, so both stay in this page's normal server
  // render rather than being deferred like matching candidates are (see
  // MatchPanel's own comment for why *that* one specifically moved behind
  // a button click).
  let comments: Awaited<ReturnType<typeof listCommentsForPost>> = [];
  try {
    comments = await listCommentsForPost(type, post.id);
  } catch (error) {
    console.error("Failed to load comments", error);
  }

  // Match UI only ever needs to appear on a post the viewer owns (see
  // MatchPanel's comment) -- so existing-match data is only fetched at
  // all when isOwner, and a failure here shows a small inline notice
  // rather than breaking the rest of the (already-successful) page. AI
  // candidates are fetched client-side by MatchPanel itself (GET
  // /api/posts/[id]/matches/candidates), not here.
  let matchPanelData: {
    matches: { id: number; counterpart: { id: number; title: string; imageUrl: string | null } }[];
  } | null = null;
  let matchLoadError = false;

  if (isOwner) {
    try {
      const matchResult = await listMatchesForPost(type, post.id, currentUser.id);
      const matches =
        matchResult.kind === "ok"
          ? matchResult.data.map((m) => ({
              id: m.id,
              counterpart: type === "lost" ? m.foundPost : m.lostPost,
            }))
          : [];
      matchPanelData = { matches };
    } catch (error) {
      console.error("Failed to load match data", error);
      matchLoadError = true;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <ViewTracker type={type} postId={post.id} />
      {post.imageUrl ? (
        // Not `fill` + a fixed aspect-video box: that forces every image
        // (portrait phone photos included) into a 16:9 crop via
        // object-cover, which is what made images look "excessively
        // zoomed in" -- a tall photo has most of its height cropped away
        // to fill a wide box. Uploaded photos have no stored/known
        // dimensions (no schema/upload change was warranted just for
        // this), so width/height below are only Next.js's placeholder
        // for srcset generation -- `h-auto w-auto` overrides them at
        // render time, so the browser sizes the <img> from the actual
        // loaded file's own intrinsic dimensions (never distorted, never
        // cropped). `max-w-full` shrinks large images to fit the column;
        // `max-h-[70vh]` caps a very tall portrait so it can't dominate
        // the whole page; neither one *enlarges* a small image past its
        // real resolution. The surrounding box only needs to center
        // whatever width the image ends up at and fill the leftover
        // space with a neutral background (same tone as PostCard's
        // no-image placeholder) instead of showing bare white/black.
        <div className="flex w-full items-center justify-center overflow-hidden rounded-card border border-border bg-muted">
          <Image
            src={post.imageUrl}
            alt={post.title}
            width={1200}
            height={900}
            sizes="(min-width: 768px) 768px, 100vw"
            className="h-auto max-h-[70vh] w-auto max-w-full"
            priority
          />
        </div>
      ) : (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-card border border-dashed border-border text-sm text-muted-foreground">
          <ImageOffIcon className="size-7" />
          등록된 이미지가 없습니다.
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold text-foreground">{post.title}</h1>
          <StatusBadge status={post.status} />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground">
            {type === "lost" ? "분실물" : "습득물"}
          </span>
          <span>{post.category}</span>
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
      </div>

      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{post.description}</p>

      <div className="flex items-center justify-between rounded-card border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
        <div className="flex flex-col gap-1">
          <span>작성자: {post.author.nickname ?? "알 수 없음"}</span>
          <span>작성일: {formatDate(post.createdAt)}</span>
          <span>수정일: {formatDate(post.updatedAt)}</span>
        </div>

        {isOwner && (
          <div className="flex items-center gap-2">
            <LinkButton href={`/post/${post.id}/edit?type=${type}`} variant="secondary" size="sm">
              수정
            </LinkButton>
            <DeletePostButton id={post.id} type={type} />
          </div>
        )}
      </div>

      {/* Owner-only, mirrors legacy pages/3_내_게시물.py's status-change
          button -- a non-owner never sees this (isOwner gates it, and the
          PATCH API re-checks ownership regardless). */}
      {isOwner && (
        <StatusChangeControl
          id={post.id}
          type={type}
          currentStatus={post.status}
          statuses={type === "lost" ? LOST_STATUSES : FOUND_STATUSES}
        />
      )}

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
            작성자에게 문의하기
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
