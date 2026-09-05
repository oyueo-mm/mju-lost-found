import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { getFoundPost, getLostPost } from "@/lib/posts/service";
import { postTypeSchema } from "@/lib/posts/schema";
import { DeletePostButton } from "@/components/post/DeletePostButton";
import { listMatchesForPost } from "@/lib/match/service";
import { MatchPanel } from "@/components/match/MatchPanel";
import { encodePostTargetId } from "@/lib/report/targets";
import { ReportButton } from "@/components/report/ReportButton";

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

  // Match UI only ever needs to appear on a post the viewer owns (see
  // MatchPanel's comment) -- so existing-match data is only fetched at
  // all when isOwner, and a failure here shows a small inline notice
  // rather than breaking the rest of the (already-successful) page. AI
  // candidates are fetched client-side by MatchPanel itself (GET
  // /api/posts/[id]/matches/candidates), not here.
  let matchPanelData: {
    matches: { id: number; counterpart: { id: number; title: string; imageUrl: string | null } }[];
  } | null = null;
  let matchLoadError = false;

  if (isOwner) {
    try {
      const matchResult = await listMatchesForPost(type, post.id, currentUser.id);
      const matches =
        matchResult.kind === "ok"
          ? matchResult.data.map((m) => ({
              id: m.id,
              counterpart: type === "lost" ? m.foundPost : m.lostPost,
            }))
          : [];
      matchPanelData = { matches };
    } catch (error) {
      console.error("Failed to load match data", error);
      matchLoadError = true;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {post.imageUrl ? (
        // Not `fill` + a fixed aspect-video box: that forces every image
        // (portrait phone photos included) into a 16:9 crop via
        // object-cover, which is what made images look "excessively
        // zoomed in" -- a tall photo has most of its height cropped away
        // to fill a wide box. Uploaded photos have no stored/known
        // dimensions (no schema/upload change was warranted just for
        // this), so width/height below are only Next.js's placeholder
        // for srcset generation -- `h-auto w-auto` overrides them at
        // render time, so the browser sizes the <img> from the actual
        // loaded file's own intrinsic dimensions (never distorted, never
        // cropped). `max-w-full` shrinks large images to fit the column;
        // `max-h-[70vh]` caps a very tall portrait so it can't dominate
        // the whole page; neither one *enlarges* a small image past its
        // real resolution. The surrounding box only needs to center
        // whatever width the image ends up at and fill the leftover
        // space with a neutral background (same tone as PostCard's
        // no-image placeholder) instead of showing bare white/black.
        <div className="flex w-full items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-800">
          <Image
            src={post.imageUrl}
            alt={post.title}
            width={1200}
            height={900}
            sizes="(min-width: 768px) 768px, 100vw"
            className="h-auto max-h-[70vh] w-auto max-w-full"
            priority
          />
        </div>
      ) : (
        <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-zinc-300 text-sm text-zinc-400 dark:border-zinc-700">
          등록된 이미지가 없습니다.
        </div>
      )}

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

      {currentUser && (
        <ReportButton targetType="post" targetId={encodePostTargetId(type, post.id)} />
      )}

      {isOwner &&
        (matchLoadError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            매칭 정보를 불러오는 중 문제가 발생했습니다.
          </div>
        ) : (
          matchPanelData && (
            <MatchPanel postType={type} postId={post.id} initialMatches={matchPanelData.matches} />
          )
        ))}
    </div>
  );
}
