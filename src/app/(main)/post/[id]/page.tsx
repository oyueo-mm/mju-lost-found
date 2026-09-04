import Link from "next/link";
import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { getFoundPost, getLostPost } from "@/lib/posts/service";
import { postTypeSchema } from "@/lib/posts/schema";
import { DeletePostButton } from "@/components/post/DeletePostButton";

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
  const dateLabel = post.type === "lost" ? "분실 일시" : "습득 일시";
  const dateValue = post.type === "lost" ? post.lostAt : post.foundAt;

  return (
    <div className="flex flex-col gap-6">
      <div className="aspect-video w-full rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700" />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{post.title}</h1>
          <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {post.status}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
          <span>{type === "lost" ? "분실물" : "습득물"}</span>
          <span>카테고리: {post.category}</span>
          <span>위치: {post.location}</span>
          <span>{dateLabel}: {formatDate(dateValue)}</span>
        </div>
      </div>

      <p className="whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-400">{post.description}</p>

      <div className="flex items-center justify-between rounded-lg border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <div className="flex flex-col gap-1">
          <span>작성자: {post.author.nickname ?? "알 수 없음"}</span>
          <span>작성일: {formatDate(post.createdAt)}</span>
          <span>수정일: {formatDate(post.updatedAt)}</span>
        </div>

        {isOwner && (
          <div className="flex items-center gap-2">
            <Link
              href={`/post/${post.id}/edit?type=${type}`}
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600"
            >
              수정
            </Link>
            <DeletePostButton id={post.id} type={type} />
          </div>
        )}
      </div>
    </div>
  );
}
