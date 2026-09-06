import Image from "next/image";
import Link from "next/link";

import type { PostDTO } from "@/lib/posts/service";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ImageOffIcon, PinIcon, ClockIcon, EyeIcon } from "@/components/icons";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(date);
}

type PostCardProps = {
  post: PostDTO;
  // Phase 15-2: the same `post.score` field is reused by two different
  // similarity contexts (Phase 12's text search, Phase 15-2's image
  // similarity) that must never read as the same claim -- "검색 유사도"
  // (this card matched your search terms) vs "이미지 유사도" (this card's
  // photo looks visually similar). Defaulting to the original Phase 12
  // wording keeps every existing call site (search results) unchanged.
  scoreLabel?: string;
};

// Phase 17 redesign: image-forward vertical card (was a small 64px
// thumbnail + text row) -- per this phase's own "사진 중심의 UI" design
// direction, since a lost/found item's photo is the single fastest way a
// viewer identifies whether it's theirs. Fixed 4:3 aspect ratio + object-
// cover keeps every card in a grid the same height regardless of the
// source photo's own aspect ratio (see post/[id]/page.tsx's own comment
// for why the *detail* page deliberately does NOT crop -- a card grid and
// a single full-size detail view have different needs).
export function PostCard({ post, scoreLabel = "검색 유사도" }: PostCardProps) {
  return (
    <Link
      href={`/post/${post.id}?type=${post.type}`}
      className="group flex flex-col overflow-hidden rounded-card border border-border bg-card transition-colors hover:border-foreground/30"
    >
      <div className="relative aspect-4/3 w-full shrink-0 overflow-hidden bg-muted">
        {post.imageUrl ? (
          <Image
            src={post.imageUrl}
            alt={post.title}
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
            loading="lazy"
            className="object-cover transition-transform group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
            <ImageOffIcon className="size-6" />
            <span className="text-xs">이미지 없음</span>
          </div>
        )}
        <StatusBadge status={post.status} className="absolute top-2 right-2 shadow-sm" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3.5">
        <h3 className="truncate text-sm font-semibold text-foreground">{post.title}</h3>
        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1 truncate">
            <PinIcon className="size-3.5 shrink-0" />
            <span className="truncate">{post.location}</span>
          </span>
          <span className="flex items-center gap-1">
            <ClockIcon className="size-3.5 shrink-0" />
            {formatDate(post.createdAt)}
          </span>
          {/* Phase 31: same EyeIcon+count pattern as post/[id]/page.tsx's
              own view-count display -- reuses the existing viewCount DTO
              field, no new data source. */}
          <span className="flex items-center gap-1">
            <EyeIcon className="size-3.5 shrink-0" />
            {post.viewCount}
          </span>
        </div>
        {/* Phase 12/15-2: only present on a similarity-ranked result (text
            search or image similarity) -- a plain keyword-search/list
            result never carries `score`, so this never shows up outside
            those contexts. Never labeled "AI 유사도" like MatchPanel's
            confirmed-match score, so it's never mistaken for a matching
            confirmation -- this is only ever a search/candidate ranking
            hint (see scoreLabel's own comment above). */}
        {typeof post.score === "number" && (
          <span className="mt-0.5 w-fit rounded-full bg-primary-muted px-2 py-0.5 text-[11px] font-medium text-primary">
            {scoreLabel} {Math.round(post.score * 100)}%
          </span>
        )}
      </div>
    </Link>
  );
}
