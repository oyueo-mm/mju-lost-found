import Image from "next/image";
import Link from "next/link";

import type { PostDTO } from "@/lib/posts/service";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { AuthorLink } from "@/components/user/AuthorLink";
import { ImageOffIcon, PinIcon, ClockIcon, EyeIcon } from "@/components/icons";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(date);
}

const TYPE_LABEL: Record<PostDTO["type"], string> = { lost: "분실물", found: "습득물" };

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
// viewer identifies whether it's theirs. Fixed aspect ratio + object-cover
// keeps every card in a grid the same height regardless of the source
// photo's own aspect ratio (see post/[id]/page.tsx's own comment for why
// the *detail* page deliberately does NOT crop -- a card grid and a
// single full-size detail view have different needs).
//
// Phase H-3: aspect ratio changed from 4:3 (landscape) to 4:5 (portrait-
// leaning, same crop ratio product photo grids like Instagram use for
// exactly this reason) -- most lost/found item photos are taken vertically
// on a phone, and a landscape 4:3 box was cropping away a large share of
// a portrait photo's height (top of a bag, bottom of a shoe, etc.). 4:5
// gives the photo more vertical room without introducing letterboxing
// (still a fixed ratio + object-cover, so the grid stays perfectly
// uniform) -- less of the subject is lost, and the image now makes up
// more of the card's total height instead of stopping short of it.
//
// Phase H-6: 4:5 on its own made desktop cards read as too tall once the
// grid grows past 2 columns (md:grid-cols-3/lg:grid-cols-4, see every
// caller of this component) -- each card's fixed height compounds across a
// wide multi-column row in a way it doesn't on a narrow single-column-ish
// mobile view. `md:aspect-4/3` (same breakpoint BottomNav/Header already
// use as this app's mobile/desktop line, see layout/BottomNav.tsx) switches
// back to the original, more landscape ratio from `md:` up only -- mobile
// keeps 4:5 unchanged. Still a fixed ratio + object-cover at every
// breakpoint, so every card in a given row stays exactly the same height
// (never distorted, never a mix of ratios within one grid).
// Phase H-7: the card is no longer one giant <Link> -- adding a clickable
// author nickname (this phase's own spec) inside it would otherwise nest
// an <a> inside an <a>, which is invalid HTML and makes the inner link's
// click target browser-dependent/unreliable. Instead this uses the
// standard "stretched link" technique: the outer element is a plain
// `relative` div, the post-navigation Link is an absolutely-positioned
// `inset-0` overlay as the LAST child (so it paints on top of everything
// in normal stacking order), and the one interactive element that should
// win over it -- AuthorLink -- gets `relative z-10` so it stays on top of
// the overlay specifically. Clicking anywhere else on the card still
// navigates to the post exactly as before; clicking the author name goes
// to their profile instead. `group`/`group-hover` (image zoom on hover)
// still work unchanged -- :hover is based on the pointer being over the
// element's box, independent of which descendant is topmost for clicks.
export function PostCard({ post, scoreLabel = "검색 유사도" }: PostCardProps) {
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-card border border-border bg-card transition-colors hover:border-foreground/30">
      <div className="relative aspect-4/5 w-full shrink-0 overflow-hidden bg-muted md:aspect-4/3">
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
        {/* Phase G-2: on /search (mixed 분실물+습득물 results), the status
            badge alone ("찾는 중"/"보관 중") only implies which board a card
            belongs to -- this makes it explicit. Harmless on /lost and
            /found too (board is already fixed there by the page itself),
            so it's added unconditionally rather than threading a new prop
            through every PostCard call site just to hide it there. */}
        <span className="absolute top-2 left-2 inline-flex shrink-0 items-center rounded-full bg-card/90 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm">
          {TYPE_LABEL[post.type]}
        </span>
        <StatusBadge status={post.status} className="absolute top-2 right-2 shadow-sm" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3.5">
        <AuthorLink
          nickname={post.author.nickname}
          publicId={post.author.publicId}
          className="relative z-10 w-fit truncate text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
        />
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
        {/* Phase 12/15-2: only present on a similarity-ranked result (search
            results, or the post detail page's AI recommendations) -- a plain
            keyword-search/list result never carries `score`, so this never
            shows up outside those contexts. Always labeled by the caller
            ("검색 유사도"/"추천도", see scoreLabel above) so it reads as a
            ranking hint, never as a confirmed same-item claim. */}
        {typeof post.score === "number" && (
          <span className="mt-0.5 w-fit rounded-full bg-primary-muted px-2 py-0.5 text-[11px] font-medium text-primary">
            {scoreLabel} {Math.round(post.score * 100)}%
          </span>
        )}
      </div>

      <Link href={`/post/${post.id}?type=${post.type}`} aria-label={post.title} className="absolute inset-0" />
    </div>
  );
}
