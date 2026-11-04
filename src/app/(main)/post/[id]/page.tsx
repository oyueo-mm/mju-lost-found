import { prisma } from "@/lib/db/prisma";
import { managementScope, inManagementScope, managementHistory } from "@/lib/posts/management";
import { PostManagement } from "@/components/post/PostManagement";
import { custodyView, MANAGEMENT_ACTION_LABELS } from "@/lib/posts/custodySchema";
import { FallbackImage } from "@/components/ui/FallbackImage";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { getFoundPost, getLatestStatusChange, getLostPost, type PostDTO } from "@/lib/posts/service";
import { dateOnlyToDb, postEventDateTime } from "@/lib/posts/eventDate";
import { FOUND_STATUSES, LOST_STATUSES, postTypeSchema } from "@/lib/posts/schema";
import { can, canAny } from "@/lib/permissions/check";
import { listCommentsForPost } from "@/lib/comment/service";
import { getMyOrganizationMemberships, getOrganizationById, getOrganizationRole } from "@/lib/organization/service";
import { PostManageMenu } from "@/components/post/PostManageMenu";
import { ThankReviewDialog } from "@/components/thanks/ThankReviewDialog";
import { thankComposerFor } from "@/lib/thanks/service";
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
import { StatusScreen } from "@/components/layout/StatusScreen";
import { LinkButton } from "@/components/ui/Button";
import { ChevronRightIcon, ImageOffIcon, EyeIcon } from "@/components/icons";
import { ExpandableDescription } from "@/components/post/ExpandableDescription";
import type { TranslationKey } from "@/lib/i18n/translate";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { LOCALE_INTL_TAG, type Locale } from "@/lib/i18n/config";
import { campusLabelKey, postCategoryLabel, postTypeLabelKey, statusLabelKeyOrNull } from "@/lib/i18n/labels";
import { recordDaily } from "@/lib/metrics/record";

// 다국어(i18n) Phase: 하드코딩된 "ko-KR" 대신 현재 언어의 Intl 태그를
// 쓴다. 타임존은 언제나 Asia/Seoul 그대로 -- 캠퍼스에서 실제로 일어난
// 일의 시각이므로, 보는 사람의 언어가 바뀐다고 기준 시간대까지 바뀌면
// 오히려 틀린 정보가 된다.
function formatDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALE_INTL_TAG[locale], {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(date);
}

// A date-only 분실/습득 날짜 ("YYYY-MM-DD"): formatted from its UTC-midnight
// Date *in UTC*, so the calendar day shown is exactly the stored one.
function formatDateOnly(dateOnly: string, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALE_INTL_TAG[locale], { dateStyle: "medium", timeZone: "UTC" }).format(
    dateOnlyToDb(dateOnly),
  );
}

// The photo column: a bounded frame, the whole photo inside (object-contain).
const PHOTO_FRAME = "aspect-[4/3] md:aspect-square";
const PHOTO_SIZES = "(min-width: 1280px) 448px, (min-width: 768px) 384px, 100vw";

// A notice kept short: one line, and the full text one tap away (nothing of
// the legal / safety wording is dropped).
function Notice({ short, full, more }: { short: string; full: string; more: string }) {
  return (
    <details className="group rounded-lg bg-muted/70 px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md break-keep [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-primary">
        <span className="text-foreground">{short}</span>
        <span className="inline-flex items-center gap-0.5 font-medium whitespace-nowrap text-primary">
          {more}
          <ChevronRightIcon aria-hidden="true" className="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
        </span>
      </summary>
      <p className="mt-1.5 [overflow-wrap:anywhere]">{full.replace(/^\p{Extended_Pictographic}️?\s*/u, "")}</p>
    </details>
  );
}

export default async function PostDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string; created?: string }>;
}) {
  const [t, locale] = await Promise.all([getTranslator(), getLocale()]);
  // 분실/습득 날짜/시각 분리: 날짜+시간 -> the full date and time; 날짜만 ->
  // "2026. 10. 6. · 시간 미상"; 날짜도 모름 -> "분실/습득 시점 미상" alone.
  const formatEventDateTime = (post: PostDTO): string | null => {
    const event = postEventDateTime(post);
    if (event.at) return formatDate(event.at, locale);
    if (event.date) return `${formatDateOnly(event.date, locale)} · ${t("post.timeUnknown")}`;
    return null;
  };

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
  // Hidden/removed posts are visible to those who moderate content; only 게시글 삭제 may delete others' comments.
  const viewerIsAdmin = canAny(currentUser, ["posts.manage", "posts.delete", "reports.view"]);
  const viewerCanDelete = can(currentUser, "posts.delete");
  // 게시판 상태 변경 이력: shown to the author and admins only.
  const lastStatusChange = isOwner || viewerIsAdmin ? await getLatestStatusChange(type, post.id) : null;
  const statusText = (status: string) => {
    const key = statusLabelKeyOrNull(status);
    return key ? t(key) : status;
  };
  // 회원탈퇴: a withdrawn author's leftover post is for admins only (it is
  // kept for other users' comments or as a pending report's evidence).
  if (post.removedAt && !viewerIsAdmin) notFound();

  // Legal pre-beta Phase: a temporarily hidden post (임시 숨김 on a
  // rights-infringement report) is visible only to its author and admins.
  const tempHidden = Boolean(post.tempHiddenAt);
  if (tempHidden && !isOwner && !viewerIsAdmin) {
    return (
      <StatusScreen
        title="임시 숨김 처리된 게시글이에요"
        description="권리침해 신고가 접수되어 검토가 끝날 때까지 게시글이 숨겨져 있어요."
        actions={
          <>
            <LinkButton href="/lost">분실물 게시판</LinkButton>
            <LinkButton href="/found" variant="secondary">
              습득물 게시판
            </LinkButton>
          </>
        }
      />
    );
  }
  const scope = currentUser ? await managementScope(currentUser.id) : null;
  const custody = post.type === "found" ? post.custody ?? null : null;
  const canManage = scope && (post.type === "found" || scope.platform) && inManagementScope(scope, post.campus, custody, post.type === "found" ? post.custodyOrganizationId : null, post.type === "found" ? post.pendingTransferOrganizationId : null);
  const institutions = canManage ? await prisma.organization.findMany({ where: { managementCampus: { not: null }, status: "ACTIVE" }, select: { id: true, name: true } }) : [];
  const history = canManage && currentUser ? await managementHistory(currentUser.id, type, post.id) : [];
  // 감사 쪽지: offered only after the post was marked done from a chat room,
  // to the person who got the item back through that return (lib/thanks).
  // A failure only hides the offer.
  const thankComposer =
    currentUser && (post.status === "완료" || post.status === "찾음")
      ? await thankComposerFor(currentUser.id, type, post.id).catch((error) => {
          console.error("Failed to load thank-note state", error);
          return null;
        })
      : null;
  const dateLabel = post.type === "lost" ? t("post.lostAt") : t("post.foundAt");
  const custodyInfo = post.type === "found" ? custodyView(custody, post.status === "완료") : null;
  const hasPhotos = (post.images?.length ?? 0) >= 2 || Boolean(post.imageUrl);
  const dateText = formatEventDateTime(post);

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
      const recommendations = await findPostRecommendations(type, post!.id);
      // 운영 통계: AI 추천 shown on a post page (not the creator's polling).
      if (recommendations.length > 0) recordDaily("recommend.shown");
      return { recommendations, recommendationsFailed: false };
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

  // Phase 12-11 §18/§19: whether to show "단체에 문의하기" at all (only for
  // an organization-attributed post) and whether it should be usable right
  // now. A LEADER/ADMIN of *this exact* organization never sees the
  // button -- inquiring with one's own organization is meaningless (see
  // chat/service.ts's own getOrCreateOrganizationChatRoom, which rejects
  // this server-side regardless; this is purely proactive UI, not the
  // real gate). An INACTIVE organization keeps the button visible but
  // disabled -- existing inquiry rooms stay reachable from /chat, only
  // *new* ones are blocked (§17).
  async function loadOrganizationChatEligibility(): Promise<{ show: boolean; disabled: boolean }> {
    if (post!.organizationId === null) return { show: false, disabled: false };
    try {
      const [organization, role] = await Promise.all([
        getOrganizationById(post!.organizationId),
        currentUser ? getOrganizationRole(post!.organizationId, currentUser.id) : Promise.resolve(null),
      ]);
      if (role === "leader" || role === "admin") return { show: false, disabled: false };
      return { show: true, disabled: !organization || organization.status !== "active" };
    } catch (error) {
      console.error("Failed to load organization chat eligibility", error);
      return { show: true, disabled: false };
    }
  }

  // 카테고리 대분류-소분류: "전자기기 · 이어폰" -- categoryCode가 있으면 새
  // 분류, 없으면 기존 category(PostCard와 같은 postCategoryLabel).
  const categoryLine = postCategoryLabel(post, t);
  const campusKey = campusLabelKey(post.campus);

  const [comments, { recommendations, recommendationsFailed }, myOrganizations, organizationChat] = await Promise.all([
    loadComments(),
    loadRecommendations(),
    loadMyOrganizations(),
    loadOrganizationChatEligibility(),
  ]);
  // Phase 12-11: an organization post's entry point follows organizationChat
  // (open to its literal author too, unless a manager of that organization);
  // a personal post is never offered to its own author.
  const showChat = post.organizationId !== null ? organizationChat.show : !isOwner;

  return (
    <div className="flex flex-col gap-6">
      {tempHidden && (
        <p className="rounded-card border border-warning/40 bg-warning-muted px-4 py-2.5 text-sm text-warning">
          권리침해 신고로 임시 숨김 처리된 게시글입니다. 작성자와 관리자에게만 보이며, 다른 이용자에게는 보이지 않습니다.
          이의가 있으면 &lsquo;서비스 개선 제안&rsquo;으로 알려주세요.
        </p>
      )}
      <ViewTracker type={type} postId={post.id} />
      {justCreated &&
        (isOwner ? (
          // 연속 등록: the next item starts from a fresh form; only the
          // campus and 게시 주체 come over (see posts/nextPostDefaults.ts).
          <div className="flex flex-col gap-2.5 rounded-card bg-success-muted px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium text-success">{t("post.created")}</p>
            <LinkButton href={`/${type}/new?after=${post.id}`} size="sm" className="w-full sm:w-auto">
              {t(type === "found" ? "post.registerNext.found" : "post.registerNext.lost")}
            </LinkButton>
          </div>
        ) : (
          <p className="rounded-card bg-success-muted px-4 py-2.5 text-sm font-medium text-success">
            {t("post.created")}
          </p>
        ))}
      {/* Phase 3-A (B안, 정보 우선): what the item is, its state, where and when
          and where it is kept now, then the main action -- on the left; the
          photos on the right from md. A phone shows the same column first and
          the photos after the main action. Nothing was dropped: author,
          category, campus, place, date, views, 작성일, the last status change,
          the manage menu / 신고, the custody facts and the notices all stay. */}
      <article
        className={`grid items-start gap-6 ${hasPhotos ? "md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] md:gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] wide-board:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]" : ""}`}
      >
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground">{t(postTypeLabelKey(type))}</span>
              <StatusBadge status={post.status} />
            </div>
            {/* Phase I section 8: the owner gets the manage menu, any other
                signed-in user 신고 -- never both, always in this one place. */}
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
                  buttonLabel={t("report.short")}
                  triggerClassName="flex h-9 shrink-0 items-center rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                />
              )
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-xl leading-snug font-bold text-foreground [overflow-wrap:anywhere] md:text-2xl">{post.title}</h1>
            {/* Phase 12-8 §2/§3: an organization post shows ONLY the
                organization (AttributionLink). */}
            <AttributionLink
              organizationId={post.organizationId}
              organizationName={post.organizationName}
              author={post.author}
              className="w-fit max-w-full truncate text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
              iconClassName="size-4 shrink-0"
            />
          </div>

          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 border-y border-border py-3.5 text-sm">
            <dt className="text-muted-foreground">{t("post.detail.category")}</dt>
            {/* 카테고리/캠퍼스: labels are translated; a value outside the
                lists (an older free-text category) is shown as stored. */}
            <dd className="min-w-0 text-foreground [overflow-wrap:anywhere]" data-post-category>
              {categoryLine}
            </dd>
            <dt className="text-muted-foreground">{t(post.type === "lost" ? "post.detail.lostPlace" : "post.detail.foundPlace")}</dt>
            <dd className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-foreground [overflow-wrap:anywhere]">
              <span className="rounded-full bg-primary-muted px-2 py-px text-xs font-medium text-primary">{campusKey ? t(campusKey) : post.campus}</span>
              <span className="min-w-0">{post.location ?? t("post.locationUnknown")}</span>
            </dd>
            <dt className="text-muted-foreground">{dateLabel}</dt>
            <dd className="min-w-0 text-foreground">
              {dateText ?? t(post.type === "lost" ? "post.lostDateUnknown" : "post.foundDateUnknown")}
            </dd>
            {custodyInfo && (
              <>
                <dt className="text-muted-foreground">{t("post.custody.stateLabel")}</dt>
                <dd className="min-w-0 text-foreground [overflow-wrap:anywhere]" data-custody-state>
                  {custodyInfo.stateText ?? t(custodyInfo.stateKey as TranslationKey)}
                  {custodyInfo.noteKey && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {t(custodyInfo.noteKey as TranslationKey, { institution: custodyInfo.institution ?? "" })}
                    </span>
                  )}
                </dd>
                {(custodyInfo.place || custodyInfo.placeKey) && (
                  <>
                    <dt className="text-muted-foreground">{t("post.custody.placeLabel")}</dt>
                    <dd className="min-w-0 text-foreground [overflow-wrap:anywhere]">{custodyInfo.place ?? t(custodyInfo.placeKey as TranslationKey)}</dd>
                  </>
                )}
              </>
            )}
            {post.type === "found" && !custodyInfo && (
              <>
                <dt className="text-muted-foreground">{t("post.custody.stateLabel")}</dt>
                <dd className="min-w-0 text-muted-foreground" data-custody-state>
                  {t("post.custody.none")}
                </dd>
              </>
            )}
          </dl>

          <ExpandableDescription text={post.description} className="text-[15px] leading-relaxed text-foreground" />

          {/* The main action. Phase 10/14: someone else's post only (never a
              chat with yourself); signed out, the same button goes through
              sign-in and back. Phase 12-11: an organization post asks the
              organization -- hidden from its own managers, disabled once the
              organization is closed. The API re-checks all of it. */}
          {showChat && (
            <div className="flex flex-col gap-2">
              {organizationChat.disabled ? (
                <span className="w-fit rounded-full border border-border px-4 py-2 text-sm font-medium text-muted-foreground opacity-60">
                  {t("post.closedOrganization")}
                </span>
              ) : currentUser ? (
                <DirectChatButton postType={type} postId={post.id} isOrganizationPost={post.organizationId !== null} wide />
              ) : (
                <Link
                  href={`/login?reason=chat&callbackUrl=${encodeURIComponent(`/post/${post.id}?type=${type}`)}`}
                  className="flex min-h-11 w-full items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:w-fit"
                >
                  {post.organizationId !== null ? t("post.contactOrganization") : t("post.startChat")}
                </Link>
              )}
              {/* LOST112 연계 §9/§10: contacting a found post's finder */}
              {post.type === "found" && (
                <Notice short={t("post.foundContactNotice.short")} full={t("post.foundContactNotice")} more={t("post.notice.more")} />
              )}
            </div>
          )}
          {post.type === "lost" && (
            <Notice short={t("post.lostPropertyNotice.short")} full={t("post.lostPropertyNotice")} more={t("post.notice.more")} />
          )}

          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {/* 작성일 only: updated_at is not a trustworthy edit time for
                  older posts (views used to move it). */}
              <span>{t("post.createdAt", { created: formatDate(post.createdAt, locale) })}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                <EyeIcon aria-hidden="true" className="size-3.5" />
                <span className="sr-only">{t("post.detail.views")}</span>
                {post.viewCount}
              </span>
              {!hasPhotos && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <ImageOffIcon aria-hidden="true" className="size-3.5" />
                    {t("post.noImage")}
                  </span>
                </>
              )}
            </p>
            {lastStatusChange && (
              <p>
                {t("post.lastStatusChange", {
                  from: statusText(lastStatusChange.fromStatus),
                  to: statusText(lastStatusChange.toStatus),
                  date: formatDate(lastStatusChange.createdAt, locale),
                })}
              </p>
            )}
          </div>
        </div>

        {/* Photos: a bounded frame (whole photo, object-contain) instead of a
            65vh hero. Phase 11-4D: 2+ images use the gallery (swipe, arrows,
            thumbnails); a single image the same frame; none, no frame at all
            (the caption above says so). */}
        {hasPhotos && (
          <div className="min-w-0 md:sticky md:top-[calc(var(--header-height)+1rem)]">
            {(post.images?.length ?? 0) >= 2 ? (
              <PostImageGallery images={post.images!} title={post.title} frameClassName={PHOTO_FRAME} sizes={PHOTO_SIZES} />
            ) : (
              <div className={`relative w-full overflow-hidden rounded-card border border-border bg-muted ${PHOTO_FRAME}`}>
                <FallbackImage
                  src={post.imageUrl!}
                  alt={post.title}
                  fill
                  sizes={PHOTO_SIZES}
                  className="object-contain"
                  priority
                  fallback={
                    <span role="img" aria-label={post.title} className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                      <ImageOffIcon aria-hidden="true" className="size-7" />
                    </span>
                  }
                />
              </div>
            )}
          </div>
        )}
      </article>

      {/* 감사 후기 (Phase 3-B): the same dialog as the chat room's 반환 완료
          card, offered only to whom lib/thanks allows; optional. */}
      {thankComposer &&
        (thankComposer.alreadySent ? (
          <p role="status" className="rounded-lg bg-muted/70 px-3.5 py-2.5 text-sm text-muted-foreground">
            {t("thanks.review.sentDone")}
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/70 px-3.5 py-2.5 text-sm">
            <span className="break-keep [overflow-wrap:anywhere] text-foreground">{t("thanks.prompt.body")}</span>
            <ThankReviewDialog
              postType={type}
              postId={post.id}
              receiverName={thankComposer.receiver?.nickname ?? null}
              postTitle={post.title}
              postImageUrl={post.imageUrl ?? null}
              triggerLabel={t("thanks.review.open")}
            />
          </div>
        ))}

      {/* 물품 접수·반환 관리: officers only (managementScope / inManagementScope,
          unchanged), apart from the post itself and folded so it never pushes
          the post's own sections down. */}
      {canManage && (
        <details className="group rounded-card border border-border bg-card">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 rounded-card px-4 py-3 text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-primary">
            {t("post.management.title")}
            <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
          </summary>
          <div className="flex flex-col gap-4 border-t border-border p-4">
            <PostManagement key={post.updatedAt.toISOString()} id={post.id} type={type} updatedAt={post.updatedAt.toISOString()} completed={post.status === "완료" || post.status === "찾음"} confirmedCustody={Boolean(custody?.confirmedAt)} platform={scope!.platform} scopeOrganizationId={scope!.organizationId} permissions={scope!.permissions} organizationId={post.type === "found" ? post.custodyOrganizationId : null} pendingOrganizationId={post.type === "found" ? post.pendingTransferOrganizationId : null} institutions={institutions} />
            {history.length > 0 && <details className="text-sm"><summary className="cursor-pointer">물품 처리 이력</summary><ul className="mt-3 space-y-2">{history.map((h) => <li key={h.id}>{formatDate(h.createdAt, locale)} · {h.changedBy?.nickname ?? "담당자"} · {h.institution ?? "작성자"} · {MANAGEMENT_ACTION_LABELS[h.action ?? ""] ?? "상태 변경"} · {h.fromStatus} → {h.toStatus}{h.reason && <p className="text-muted-foreground">사유: {h.reason}</p>}</li>)}</ul></details>}
          </div>
        </details>
      )}

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
        isAdmin={viewerCanDelete}
        myOrganizations={myOrganizations}
      />
    </div>
  );
}
