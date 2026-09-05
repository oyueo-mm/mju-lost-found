import Image from "next/image";
import Link from "next/link";

import type { PostDTO } from "@/lib/posts/service";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(date);
}

export function PostCard({ post }: { post: PostDTO }) {
  return (
    <Link
      href={`/post/${post.id}?type=${post.type}`}
      className="flex gap-4 rounded-lg border border-zinc-200 p-4 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
    >
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-800">
        {post.imageUrl ? (
          <Image
            src={post.imageUrl}
            alt={post.title}
            fill
            sizes="64px"
            loading="lazy"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400">
            No Image
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate font-medium text-zinc-900 dark:text-zinc-50">{post.title}</h3>
          <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {post.status}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
          <span>{post.category}</span>
          <span>{post.location}</span>
          <span>{formatDate(post.createdAt)}</span>
        </div>
        {/* Phase 12: only present on an AI semantic search result -- a
            plain keyword-search/list result never carries `score`, so
            this never shows up outside that one context. Labeled "검색
            유사도" (search similarity), not "AI 유사도" like MatchPanel's
            confirmed-match score, so it's never mistaken for a matching
            confirmation -- this is only ever a search ranking hint. */}
        {typeof post.score === "number" && (
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            검색 유사도 {Math.round(post.score * 100)}%
          </span>
        )}
      </div>
    </Link>
  );
}
