import Link from "next/link";

import type { PostDTO } from "@/lib/posts/service";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(date);
}

export function PostCard({ post }: { post: PostDTO }) {
  return (
    <Link
      href={`/post/${post.id}?type=${post.type}`}
      className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium text-zinc-900 dark:text-zinc-50">{post.title}</h3>
        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {post.status}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
        <span>{post.category}</span>
        <span>{post.location}</span>
        <span>{formatDate(post.createdAt)}</span>
      </div>
    </Link>
  );
}
