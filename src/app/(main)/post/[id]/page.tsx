import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { getFoundPost, getLostPost } from "@/lib/posts/service";
import { FOUND_STATUSES, LOST_STATUSES, postTypeSchema } from "@/lib/posts/schema";
import { isAdmin } from "@/lib/moderation/service";
import { listCommentsForPost } from "@/lib/comment/service";
import { getMyOrganizationMemberships } from "@/lib/organization/service";
import { PostManageMenu } from "@/components/post/PostManageMenu";
import { PostImageGallery } from "@/components/post/PostImageGallery";
import { ViewTracker } from "@/components/post/ViewTracker";
import { PendingRecommendations } from "@/components/post/PendingRecommendations";
import { DirectChatButton } from "@/components/chat/DirectChatButton";
import { findPostRecommendations } from "@/lib/recommendation/service";
import { CommentSection } from "@/components/comment/CommentSection";
import { encodePostTargetId } from "@/lib/report/targets";
import { ReportButton } from "@/components/report/ReportButton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { AttributionLink } from "@/components/user/AttributionLink";
import { ImageOffIcon, PinIcon, ClockIcon, EyeIcon } from "@/components/icons";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

// Phase P-5: null means the poster marked the time as unknown -- see
// schema.prisma's own comment on LostPost.lostAt/FoundPost.foundAt.
function formatDateOrUnknown(date: Date | null): string {
  return date ? formatDate(date) : "시간 미상";
}

export default async function PostDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string; created?: string }>;
}) {
  const { id: idParam } = await params;
  const { type: typeParam, created } = await searchParams;
  // Phase 11-2: set only by PostForm's own post-creation redirect (never
  // by an edit, and never by anyone just sharing/revisiting this URL --
  // there's nothing sensitive gated by it, it only turns on the "게시글이
  // 등록되었습니다" banner and PendingRecommendations' polling below, both
  // purely cosmetic).
  const justCreated = created === "1";

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
  // render.
  //
  // Phase 24-2-2: comments and recommendations don't depend on each other
  // -- only on `post`, already resolved above -- so their DB round trips
  // run concurrently instead of one after the other. Each keeps its own
  // try/catch (a comments failure still can't affect recommendations and
  // vice versa); only the *waiting* is shared.
  async function loadComments(): Promise<Awaited<ReturnType<typeof listCommentsForPost>>> {
    try {
      return await listCommentsForPost(type, post!.id);
    } catch (error) {
      console.error("Failed to load comments", error);
      return [];
    }
  }

  // Phase J-2: replaces the removed owner-only MatchPanel. Recommendations
  // are computed from this post's *own* stored text/image embeddings
  // (src/lib/recommendation/service.ts), so nothing here runs a model at
  // request time -- just a cached pgvector ranking plus one row fetch,
  // cheap enough to stay in the normal server render rather than being
  // deferred behind a click the way Match candidates were. Public: every
  // viewer (logged in or not, owner or not) gets the same list, matching
  // how this page's similar-posts section already behaved. A failure shows
  // a small inline notice instead of breaking the rest of the page.
  async function loadRecommendations(): Promise<{
    recommendations: Awaited<ReturnType<typeof findPostRecommendations>>;
    recommendationsFailed: boolean;
  }> {
    try {
      return { recommendations: await findPostRecommendations(type, post!.id), recommendationsFailed: false };
    } catch (error) {
      console.error("Failed to load recommendations", error);
      return { recommendations: [], recommendationsFailed: true };
    }
  }

  // Phase 12-5 §22: same server-fetched-membership convention as
  // lost/new, found/new page.tsx's own myOrganizations -- only fetched for
  // a logged-in viewer (a logged-out one never sees the comment composer
  // at all, see CommentSection's own currentUser-gated form).
  async function loadMyOrganizations() {
    if (!currentUser) return [];
    try {
      const memberships = await getMyOrganizationMemberships(currentUser.id);
      return memberships
        .filter((m) => m.organizationStatus === "active")
        .map((m) => ({ organizationId: m.organizationId, organizationName: m.organizationName }));
    } catch (error) {
      console.error("Failed to load organization memberships", error);
      return [];
    }
  }

  const [comments, { recommendations, recommendationsFailed }, myOrganizations] = await Promise.all([
    loadComments(),
    loadRecommendations(),
    loadMyOrganizations(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <ViewTracker type={type} postId={post.id} />
      {justCreated && (
        <p className="rounded-card bg-success-muted px-4 py-2.5 text-sm font-medium text-success">
          게시글이 등록되었습니다.
        </p>
      )}
      {/* Phase 11-4D: post.images (ordered by displayOrder, see
          getLostPost/getFoundPost) is what decides which of the three
          states renders -- post.imageUrl (the primary-image cache) still
          agrees with post.images[0] by construction (see PostImage's own
          sync invariant), so the 2+ case is the only one that changed
          behavior here; 0 and 1 render exactly the same markup this page
          already had before this phase. */}
      {(post.images?.length ?? 0) >= 2 ? (
        <PostImageGallery images={post.images!} title={post.title} />
      ) : post.imageUrl ? (
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
            {/* Phase H-7: clickable, same as every other author display in
                this app (PostCard/CommentSection/chat header) -- including
                on the viewer's own post, which goes to their own profile,
                same as anyone else's. Phase 12-8 §2/§3: an organization-
                attributed post shows ONLY the organization here -- see
                AttributionLink's own comment for why the real author is
                never rendered alongside it. */}
            <AttributionLink
              organizationId={post.organizationId}
              organizationName={post.organizationName}
              author={post.author}
              className="w-fit truncate text-sm font-medium text-primary hover:underline"
              iconClassName="size-4 shrink-0"
            />
            <h1 className="text-xl font-semibold text-foreground md:text-2xl">{post.title}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <StatusBadge status={post.status} />
            {/* Phase I section 8: 소유자는 관리 메뉴, 그 외 로그인 사용자는 신고
                액션 -- 항상 둘 중 하나만(동시에 둘 다는 절대 없음) 같은 자리에
                렌더링해서 "관리/보조 액션 영역"을 하나로 통일했다. 기존에는
                신고 버튼이 콘텐츠 중앙(채팅하기/매칭 사이)에 별도 줄로
                떠 있었는데, 그 자리를 없애고 여기로 옮긴 것뿐 -- 신고 API,
                권한 검사(자기 신고 거부 등)는 ReportButton/createReport 그대로,
                UI 위치와 트리거 스타일만 바뀌었다. */}
            {isOwner ? (
              <PostManageMenu
                id={post.id}
                type={type}
                currentStatus={post.status}
                statuses={type === "lost" ? LOST_STATUSES : FOUND_STATUSES}
              />
            ) : (
              currentUser && (
                <ReportButton
                  targetType="post"
                  targetId={encodePostTargetId(type, post.id)}
                  buttonLabel="신고"
                  triggerClassName="flex h-9 shrink-0 items-center rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                />
              )
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
            {post.location ?? "위치 미상"}
          </span>
          <span className="flex items-center gap-1">
            <ClockIcon className="size-3.5" />
            {dateLabel}: {formatDateOrUnknown(dateValue)}
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

      {/* Phase J-2: one automatic "AI 추천" section replaces both the
          owner-only MatchPanel (매칭 후보 찾기 -> 매칭하기) and Phase I's
          manual search widget (자연어로/이미지로 찾기). Nothing to pick or
          type: the recommendations are derived from this post's own
          embeddings server-side above and are the same for every viewer.
          Board-wide search (키워드/AI 의미/이미지) is unchanged and still
          lives on /lost, /found and /search.
          Phase 11-2: wrapped in PendingRecommendations instead of
          rendering SimilarPostsSection directly -- when justCreated,
          this post's embedding may still be computing in the background
          (see aiService.ts's createLostPost/createFoundPost), so this
          polls a few times for results instead of just showing an empty
          state that only fills in on some later, unrelated visit. Every
          other visit (justCreated=false) behaves exactly as before: no
          polling, plain static render of whatever the server already
          computed above. */}
      <PendingRecommendations
        sourceType={type}
        sourceId={post.id}
        initialRecommendations={recommendations}
        initialFailed={recommendationsFailed}
        pollForResults={justCreated}
      />

      <CommentSection
        postType={type}
        postId={post.id}
        initialComments={comments}
        currentUser={currentUser ? { id: currentUser.id } : null}
        isAdmin={viewerIsAdmin}
        myOrganizations={myOrganizations}
      />
    </div>
  );
}
