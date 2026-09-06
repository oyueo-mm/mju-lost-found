import { requireReadyUser } from "@/lib/auth/session";
import { listFoundPostsByUser, listLostPostsByUser } from "@/lib/posts/service";
import { PostCard } from "@/components/post/PostCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/Button";
import { SectionHeader } from "@/components/ui/SectionHeader";

// "내 게시물" (Phase 9) -- mirrors legacy pages/3_내_게시물.py's two tabs,
// as two sections instead (no client-side tab state needed for a page
// this simple, and it keeps both lists visible/linkable at once). userId
// comes only from the authenticated session (requireReadyUser(), which
// redirects to /login or /onboarding as needed) -- never from a query
// param or any client-supplied value, so there's no way to list another
// user's posts by tweaking the URL.
export default async function MyPostsPage() {
  const user = await requireReadyUser("mypost", "/posts/mine");

  let lostPosts, foundPosts;
  let loadError = false;
  try {
    [lostPosts, foundPosts] = await Promise.all([
      listLostPostsByUser(user.id),
      listFoundPostsByUser(user.id),
    ]);
  } catch (error) {
    console.error("Failed to load my posts", error);
    loadError = true;
  }

  if (loadError || !lostPosts || !foundPosts) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold text-foreground">내 게시물</h1>
        <div className="rounded-card border border-destructive/30 bg-destructive-muted p-10 text-center text-sm text-destructive">
          게시물을 불러오지 못했어요. 잠시 후 다시 시도해주세요.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <h1 className="text-xl font-semibold text-foreground">내 게시물</h1>

      <section className="flex flex-col gap-4">
        <SectionHeader title="내 분실물 게시글" action={<LinkButton href="/lost/new" size="sm">분실물 등록</LinkButton>} />
        {lostPosts.length === 0 ? (
          <EmptyState title="작성한 분실물 게시글이 없어요." />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {lostPosts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="내 습득물 게시글" action={<LinkButton href="/found/new" size="sm">습득물 등록</LinkButton>} />
        {foundPosts.length === 0 ? (
          <EmptyState title="작성한 습득물 게시글이 없어요." />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {foundPosts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
