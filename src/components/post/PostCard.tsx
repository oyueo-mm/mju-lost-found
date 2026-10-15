"use client";

import { createElement, useState } from "react";
import Image from "next/image";
import Link from "next/link";

import type { PostDTO } from "@/lib/posts/service";
import { FOUND_STATUSES, LOST_STATUSES } from "@/lib/posts/schema";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { AttributionLink } from "@/components/user/AttributionLink";
import { PinIcon } from "@/components/icons";
import { useI18n } from "@/lib/i18n/client";
import { LOCALE_INTL_TAG } from "@/lib/i18n/config";
import { postCategoryLabel, postTypeLabelKey } from "@/lib/i18n/labels";
import type { Locale } from "@/lib/i18n/config";
import { categoryIconFor } from "./categoryIcons";

function formatDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALE_INTL_TAG[locale], {
    dateStyle: "medium",
    timeZone: "Asia/Seoul",
  }).format(date);
}

// "찾는 중" / "보관 중": the state every post starts in, and the board's
// default status filter.
function isInProgress(post: PostDTO): boolean {
  return post.status === (post.type === "lost" ? LOST_STATUSES[0] : FOUND_STATUSES[0]);
}

type PostCardProps = {
  post: PostDTO;
  // Phase 15-2: the same `post.score` field is reused by several different
  // similarity contexts (keyword-era Phase 12 text search, Phase 15-2 image
  // similarity, AI 검색 고도화 Phase's unified AI 검색/AI 추천) that must
  // never read as the same claim -- "검색 유사도" (this card matched your
  // search terms) vs "이미지 유사도" (this card's photo looks visually
  // similar) vs "AI 유사도" (AI 검색/AI 추천's own wording, see
  // scoreDisplay below). Defaulting to the original Phase 12 wording keeps
  // every existing call site (keyword-era search results) unchanged.
  scoreLabel?: string;
  // AI 검색 고도화 Phase: three display shapes for `score`:
  // - "percentage": search/image search's `score` is a direct, stable
  //   rescale of raw cosine similarity (vectorSearch.ts's normalizeScore,
  //   `(cosine+1)/2`), so "XX%" is meaningful there. The default.
  // - "decimal": the post-detail AI 추천 (SimilarPostsSection) shows
  //   "AI 유사도 0.87" -- rankFusion.ts's calibrated similarity, never a
  //   percentage or probability.
  // - "hidden": no badge even though `post.score` is present -- every AI
  //   검색 result (AISearchPanel) and the just-created-post recommendations.
  scoreDisplay?: "percentage" | "decimal" | "hidden";
  // 게시판 리디자인 Phase: "board" is the /lost and /found list (and the AI
  // 검색 results shown on those boards). The board already says which kind
  // of post this is and filters to the in-progress status by default, so
  // the card drops the 분실물/습득물 label and shows the status only once a
  // post is resolved (찾음/완료). Below `lg` (phones and tablets) it is a
  // list row -- thumbnail or category tile left, text right -- so a photo
  // post and a text-only post are the same height; from `lg` it is a
  // vertical card with the photo on top.
  // "default" (every other list: /search, profile, home rails, AI 추천)
  // stays a vertical card and keeps the type label and status.
  variant?: "default" | "board";
};

/// 게시판 리디자인 Phase: one skeleton for every post, photo or not --
// category, title, location | date, with the photo (when there is one)
// on top. On a phone board the card is a list row: thumbnail or category
// tile on the left, text on the right.
//
// - With a photo: a photo close to the area's shape fills it (cover, at
//   most ~20% cropped); any other -- typically a portrait phone photo --
//   is shown whole (contain) so the item is never cut off, over a blurred
//   copy of itself. A phone row thumbnail stays a cropped square, which
//   reads better at 80-96px.
// - Without one: no picture-sized area at all. A small category icon sits
//   in the category line and the description (up to 3 lines) follows the
//   title, so the card is compact but carries as much information as a
//   photo card. Never a stand-in picture that could pass for the item.
// - Author and view count are left to the detail page. An organization
//   post still names the organization (where the item is kept).
//
// Phase H-7: the card is not one giant <Link> -- the organization link
// inside it would nest an <a> in an <a>. The post link is an absolutely
// positioned `inset-0` overlay painted last, and the organization link
// gets `relative z-10` to stay clickable above it.
export function PostCard({ post, scoreLabel, scoreDisplay = "percentage", variant = "default" }: PostCardProps) {
  const { locale, t } = useI18n();
  const resolvedScoreLabel = scoreLabel ?? t("post.score.search");
  const board = variant === "board";
  const showStatus = !board || !isInProgress(post);
  const description = post.description.trim();
  const category = postCategoryLabel(post, t);
  const hasPhoto = Boolean(post.imageUrl);
  const icon = (className: string) => createElement(categoryIconFor(post), { "aria-hidden": true, className });
  const sizes = board ? "(min-width: 1024px) 300px, (min-width: 640px) 112px, 96px" : "(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw";
  // Row thumbnail: a little smaller on the narrowest phones so the text
  // column keeps enough room, a little larger in a tablet's two columns.
  const rowThumb = "size-20 shrink-0 rounded-lg min-[375px]:size-24 sm:size-28";
  // The status sits on the photo of a vertical photo card, otherwise in the
  // category line (always in the line on a phone row).
  const statusInLine = showStatus && (!hasPhoto || board);
  // cover when cropping to the media area would remove at most ~20% of
  // the photo, contain otherwise; contain until the photo has loaded.
  const mediaRatio = board ? 3 / 2 : 4 / 3;
  const [fill, setFill] = useState<"cover" | "contain">("contain");

  return (
    // Phase P-4: one `transition` covers border-color, box-shadow and the
    // small hover lift together.
    <div
      {...(!hasPhoto && { "data-no-photo": "" })}
      className={`group relative flex min-w-0 overflow-hidden rounded-card border border-border bg-card transition duration-150 hover:border-primary/40 hover:shadow-md ${
        board
          ? "gap-3 p-3 lg:flex-col lg:gap-0 lg:p-0 motion-safe:lg:hover:-translate-y-0.5"
          : "h-full flex-col motion-safe:hover:-translate-y-0.5"
      }`}
    >
      {post.imageUrl ? (
        <div
          className={`relative overflow-hidden bg-muted ${
            board ? `${rowThumb} lg:aspect-3/2 lg:h-auto lg:w-full lg:rounded-none` : "aspect-4/3 w-full shrink-0"
          }`}
        >
          <Image
            src={post.imageUrl}
            alt=""
            aria-hidden="true"
            fill
            sizes={sizes}
            loading="lazy"
            className={`scale-110 object-cover opacity-50 blur-xl ${fill === "cover" ? "hidden" : board ? "hidden lg:block" : ""}`}
          />
          <Image
            src={post.imageUrl}
            alt={post.title}
            fill
            sizes={sizes}
            loading="lazy"
            onLoad={(event) => {
              const { naturalWidth: w, naturalHeight: h } = event.currentTarget;
              if (!w || !h) return;
              const ratio = w / h;
              const kept = Math.min(ratio / mediaRatio, mediaRatio / ratio);
              setFill(kept >= 0.8 ? "cover" : "contain");
            }}
            className={`transition-transform motion-safe:group-hover:scale-[1.03] ${
              fill === "cover" ? "object-cover" : board ? "object-cover lg:object-contain" : "object-contain"
            }`}
          />
          {showStatus && (
            <span className={`absolute top-2 left-2 rounded-full bg-card shadow-sm ${board ? "hidden lg:inline-flex" : "inline-flex"}`}>
              <StatusBadge status={post.status} compact />
            </span>
          )}
        </div>
      ) : (
        board && (
          <div className={`${rowThumb} flex items-center justify-center bg-primary-muted/70 lg:hidden`}>
            <span className="flex size-10 items-center justify-center rounded-full bg-card text-primary shadow-sm">{icon("size-5")}</span>
          </div>
        )
      )}

      <div className={`flex min-w-0 flex-1 flex-col ${board ? "gap-0.5 py-0.5 lg:gap-1 lg:p-4" : "gap-1 p-3 sm:p-3.5"}`}>
        <div className="flex min-w-0 items-center gap-2">
          {!hasPhoto && (
            <span className={`size-7 shrink-0 items-center justify-center rounded-lg bg-primary-muted text-primary ${board ? "hidden lg:flex" : "flex"}`}>
              {icon("size-4")}
            </span>
          )}
          <p className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground" data-post-category>
            {/* Phase G-2: lists that mix 분실물 and 습득물 (/search, a
                profile) still say which board each card belongs to. */}
            {!board && (
              <>
                <span className="text-primary">{t(postTypeLabelKey(post.type))}</span>
                <span aria-hidden="true"> · </span>
              </>
            )}
            {category}
          </p>
          {statusInLine && <StatusBadge status={post.status} compact className={hasPhoto ? "lg:hidden" : ""} />}
        </div>
        <h3
          className={`line-clamp-2 text-[15px] leading-snug font-semibold text-foreground [overflow-wrap:anywhere] ${
            board && hasPhoto ? "lg:min-h-[2lh]" : ""
          }`}
        >
          {post.title}
        </h3>
        {!hasPhoto && description && (
          <p
            className={`text-muted-foreground [overflow-wrap:anywhere] ${
              board
                ? "line-clamp-1 text-xs sm:line-clamp-2 lg:line-clamp-3 lg:text-sm lg:leading-relaxed"
                : "line-clamp-3 text-sm leading-relaxed"
            }`}
          >
            {description}
          </p>
        )}
        {/* Phase 12-8 §2/§3: an organization post names only the
            organization, never the real author. */}
        {post.organizationId != null && (
          <AttributionLink
            organizationId={post.organizationId}
            organizationName={post.organizationName}
            author={post.author}
            className="relative z-10 text-xs font-medium text-primary hover:underline"
          />
        )}
        <div className={`mt-auto flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground ${board ? "pt-1 lg:pt-1.5" : "pt-1.5"}`}>
          <PinIcon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{post.location ?? t("post.locationUnknown")}</span>
          <span aria-hidden="true" className="shrink-0 text-border">
            |
          </span>
          <time className="shrink-0" dateTime={post.createdAt.toISOString()}>
            {formatDate(post.createdAt, locale)}
          </time>
        </div>
        {/* Phase 12/15-2/AI 검색 고도화: only on a similarity-ranked result;
            labeled by the caller, shaped by scoreDisplay (see above). */}
        {typeof post.score === "number" && scoreDisplay !== "hidden" && (
          <span className="mt-1 w-fit rounded-full bg-primary-muted px-2 py-0.5 text-[11px] font-medium text-primary">
            {scoreDisplay === "decimal"
              ? `${resolvedScoreLabel} ${post.score.toFixed(2)}`
              : `${resolvedScoreLabel} ${Math.round(post.score * 100)}%`}
          </span>
        )}
      </div>

      {/* 운영 비용: no viewport/hover prefetch -- a board page shows dozens of
          cards, and each dynamic-route prefetch is a server function call
          (measured: ~54 per list view). The post loads on click instead. */}
      <Link href={`/post/${post.id}?type=${post.type}`} prefetch={false} aria-label={post.title} className="absolute inset-0 rounded-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
    </div>
  );
}
