import Link from "next/link";

import { requireReadyUser } from "@/lib/auth/session";
import { listFoundPostsByUser, listLostPostsByUser } from "@/lib/posts/service";
import { PostCard } from "@/components/post/PostCard";

// "내 게시물" (Phase 9) -- mirrors legacy pages/3_내_게시물.py's two tabs,
// as two sections instead (no client-side tab state needed for a page
// this simple, and it keeps both lists visible/linkable at once). userId
// comes only from the authenticated session (requireReadyUser(), which
// redirects to /login or /onboarding as needed) -- never from a query
// param or any client-supplied value, so there's no way to list another
// user's posts by tweaking the URL.
export default async function MyPostsPage() {
  const user = await requireReadyUser();

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
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">내 게시물</h1>
        <div className="rounded-lg border border-red-200 bg-red-50 p-10 text-center text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          게시물을 불러오는 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">내 게시물</h1>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-zinc-900 dark:text-zinc-50">내 분실물 게시글</h2>
          <Link href="/lost/new" className="text-sm text-zinc-500 underline dark:text-zinc-400">
            분실물 등록
          </Link>
        </div>
        {lostPosts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            작성한 분실물 게시글이 없습니다.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {lostPosts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-zinc-900 dark:text-zinc-50">내 습득물 게시글</h2>
          <Link href="/found/new" className="text-sm text-zinc-500 underline dark:text-zinc-400">
            습득물 등록
          </Link>
        </div>
        {foundPosts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            작성한 습득물 게시글이 없습니다.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {foundPosts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
