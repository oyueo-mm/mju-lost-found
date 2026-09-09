import { notFound } from "next/navigation";

import { getPublicProfile } from "@/lib/user/service";
import { listPostsByUser } from "@/lib/posts/service";
import { DEFAULT_LIMIT, DEFAULT_PAGE } from "@/lib/posts/schema";
import { normalizeSearchParams } from "@/lib/posts/searchParams";
import { PostCard } from "@/components/post/PostCard";
import { Pagination } from "@/components/search/Pagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { UserIcon, BoxIcon, ClockIcon } from "@/components/icons";

function formatJoinDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(date);
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
  const { publicId } = await params;
  const profile = await getPublicProfile(publicId);
  if (!profile) notFound();

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
      <section className="flex items-center gap-4 rounded-card border border-border bg-card p-5">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary-muted text-primary">
          <UserIcon className="size-8" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate text-xl font-semibold text-foreground">{profile.nickname ?? "알 수 없음"}</h1>
          {/* Phase H-7: "공개 사용자 ID" -- the opaque publicId itself, shown
              as-is (not the internal numeric id, never exposed). */}
          <span className="truncate text-xs text-muted-foreground">ID: {profile.publicId}</span>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <div className="flex flex-col items-center gap-1.5 rounded-card border border-border bg-card p-4 text-center">
          <BoxIcon className="size-5 text-muted-foreground" />
          <span className="text-lg font-semibold text-foreground">{profile.postCount}</span>
          <span className="text-xs text-muted-foreground">공개 게시글</span>
        </div>
        <div className="flex flex-col items-center gap-1.5 rounded-card border border-border bg-card p-4 text-center">
          <ClockIcon className="size-5 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">{formatJoinDate(profile.createdAt)}</span>
          <span className="text-xs text-muted-foreground">가입일</span>
        </div>
      </section>

      {/* Phase H-8: "작성 게시글" -- Lost+Found merged, newest first,
          reusing the exact same PostCard/Pagination this app already uses
          on /lost /found /search (see listPostsByUser's own comment for
          why deleted posts never appear here, and why this needs no extra
          permission check beyond what those public list pages already
          have). */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-foreground">작성 게시글</h2>
        {!posts ? (
          <div className="rounded-card border border-destructive/30 bg-destructive-muted p-10 text-center text-sm text-destructive">
            게시글을 불러오지 못했어요. 잠시 후 다시 시도해주세요.
          </div>
        ) : posts.items.length === 0 ? (
          <EmptyState title="작성한 게시글이 없어요." />
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
