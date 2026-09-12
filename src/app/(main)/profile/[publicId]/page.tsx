import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { getPublicProfile } from "@/lib/user/service";
import { listPostsByUser } from "@/lib/posts/service";
import { DEFAULT_LIMIT, DEFAULT_PAGE } from "@/lib/posts/schema";
import { normalizeSearchParams } from "@/lib/posts/searchParams";
import { PostCard } from "@/components/post/PostCard";
import { Pagination } from "@/components/search/Pagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { ReportButton } from "@/components/report/ReportButton";
import { UserIcon, BoxIcon, ClockIcon } from "@/components/icons";
import { getTranslator } from "@/lib/i18n/server";

function formatJoinDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" }).format(date);
}

// Phase H-7: public by design ("다른 사용자의 프로필을 볼 수 있도록 한다") -- no
// requireUser()/requireReadyUser() gate, same as /post/[id] and /search
// already being viewable while logged out. getPublicProfile() itself only
// ever returns nickname/publicId/createdAt/postCount (see its own
// comment) -- never email/googleId/isAdmin/isSuspended, regardless of who
// is viewing.
export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslator();
  const { publicId } = await params;
  const [profile, currentUser] = await Promise.all([getPublicProfile(publicId), getCurrentUser()]);
  if (!profile) notFound();

  // 사용자 신고 Phase: same isOwner-style gate post/[id]/page.tsx already
  // uses for its own ReportButton -- only a logged-in viewer looking at
  // someone *else's* profile ever sees the button. A self-report is also
  // rejected server-side by createReport() regardless (see report/
  // service.ts), but there is no reason to show the control at all on
  // your own profile. Fully signed-out visitors don't see it either (same
  // "currentUser &&" gate as the post detail page), even though they could
  // technically submit and get a clean 401 -- matching this app's existing
  // convention of hiding, not just rejecting, actions a logged-out viewer
  // can never complete.
  const canReport = currentUser !== null && currentUser.id !== profile.userId;

  // Phase H-8: same publicId->id lookup getPublicProfile() already did --
  // resolved a second time here (not threaded through as an extra return
  // field) so PublicProfileDTO stays exactly what it was in H-7 for every
  // other caller. `page` only, no q/category/campus/etc -- this list is
  // never filtered/searched, just this one user's own posts, so the full
  // search-query schema (listQuerySchema) would be overkill here.
  const raw = normalizeSearchParams(await searchParams);
  const pageParam = Number(raw.page);
  const page = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : DEFAULT_PAGE;

  let posts;
  try {
    posts = await listPostsByUser(profile.userId, { page, limit: DEFAULT_LIMIT });
  } catch (error) {
    console.error("Failed to load profile posts", error);
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex items-start justify-between gap-4 rounded-card border border-border bg-card p-5">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary-muted text-primary">
            <UserIcon className="size-8" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="truncate text-xl font-semibold text-foreground">{profile.nickname ?? t("common.unknown")}</h1>
            {/* Phase H-7: "공개 사용자 ID" -- the opaque publicId itself, shown
                as-is (not the internal numeric id, never exposed). */}
            <span className="truncate text-xs text-muted-foreground">ID: {profile.publicId}</span>
          </div>
        </div>
        {/* 사용자 신고 Phase: 기존 게시글 상세의 ReportButton 배치(상태
            배지 옆, 소유자가 아닐 때만)와 같은 자리 감각 -- 프로필 헤더
            우측 상단에 작게. 이 컴포넌트 자체는 이미 targetType="user"를
            지원하고 있었다(REPORT_REASONS/createReport 모두 사전에
            일반화돼 있었음 -- report/schema.ts, report/service.ts 참고),
            빠져 있던 건 이 진입점 하나뿐이었다. */}
        {canReport && (
          <ReportButton
            targetType="user"
            targetId={profile.userId}
            buttonLabel={t("report.short")}
            triggerClassName="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          />
        )}
      </section>

      <section className="grid grid-cols-2 gap-3">
        <div className="flex flex-col items-center gap-1.5 rounded-card border border-border bg-card p-4 text-center">
          <BoxIcon className="size-5 text-muted-foreground" />
          <span className="text-lg font-semibold text-foreground">{profile.postCount}</span>
          <span className="text-xs text-muted-foreground">{t("profile.publicPosts")}</span>
        </div>
        <div className="flex flex-col items-center gap-1.5 rounded-card border border-border bg-card p-4 text-center">
          <ClockIcon className="size-5 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">{formatJoinDate(profile.createdAt)}</span>
          <span className="text-xs text-muted-foreground">{t("profile.joinedAt")}</span>
        </div>
      </section>

      {/* Phase H-8: "작성 게시글" -- Lost+Found merged, newest first,
          reusing the exact same PostCard/Pagination this app already uses
          on /lost /found /search (see listPostsByUser's own comment for
          why deleted posts never appear here, and why this needs no extra
          permission check beyond what those public list pages already
          have). */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-foreground">{t("profile.posts")}</h2>
        {!posts ? (
          <div className="rounded-card border border-destructive/30 bg-destructive-muted p-10 text-center text-sm text-destructive">
            {t("profile.loadError")}
          </div>
        ) : posts.items.length === 0 ? (
          <EmptyState title={t("profile.empty")} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {posts.items.map((post) => (
                <PostCard key={`${post.type}-${post.id}`} post={post} />
              ))}
            </div>
            <Pagination
              basePath={`/profile/${publicId}`}
              currentSearchParams={raw}
              page={posts.page}
              totalPages={posts.totalPages}
            />
          </>
        )}
      </section>
    </div>
  );
}
