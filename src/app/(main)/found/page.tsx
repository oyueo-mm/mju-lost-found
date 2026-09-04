import Link from "next/link";

import { SearchFilterBar } from "@/components/search/SearchFilterBar";
import { PostCard } from "@/components/post/PostCard";
import { listFoundPosts } from "@/lib/posts/service";
import { DEFAULT_LIMIT, DEFAULT_PAGE } from "@/lib/posts/schema";

export default async function FoundListPage() {
  let posts;
  try {
    posts = await listFoundPosts({ page: DEFAULT_PAGE, limit: DEFAULT_LIMIT });
  } catch (error) {
    console.error("Failed to load found posts", error);
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">습득물 게시판</h1>
        <div className="rounded-lg border border-red-200 bg-red-50 p-10 text-center text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          게시물을 불러오는 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">습득물 게시판</h1>
        <Link
          href="/found/new"
          className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
        >
          습득물 등록
        </Link>
      </div>
      <SearchFilterBar />
      {posts.items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          등록된 습득물 게시글이 없습니다.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {posts.items.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
