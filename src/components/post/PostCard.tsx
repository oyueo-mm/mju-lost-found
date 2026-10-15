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
  // post is resolved (찾음/완료). Its layout follows the screen (CSS
  // variants in globals.css):
  // - desktop: a vertical card, photo on top;
  // - phone, 격자형 (default; `board-tile`): a compact vertical card for a
  //   two-column grid;
  // - phone 목록형 and every tablet (`board-row`): a list row -- thumbnail
  //   or category tile left, text right.
  // "default" (every other list: /search, profile, home rails, AI 추천)
  // stays a vertical card and keeps the type label and status.
  variant?: "default" | "board";
};

// 게시판 리디자인 Phase: one skeleton for every post, photo or not --
// category, title, location | date, with the photo (when there is one)
// on top, or on the left in a list row.
//
// - With a photo: a photo close to the area's shape fills it (cover, at
//   most ~20% cropped); any other -- typically a portrait phone photo --
//   is shown whole (contain) so the item is never cut off, over a blurred
//   copy of itself. A list-row thumbnail stays a cropped square, which
//   reads better at 80-112px.
// - Without one: no picture-sized area at all. A small category icon sits
//   in the category line and the description follows the title, so the
//   card is compact but carries as much information as a photo card. A
//   list row shows a category tile where the thumbnail would be. Never a
//   stand-in picture that could pass for the item.
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
  const sizes = board
    ? "(min-width: 1440px) 270px, (min-width: 1024px) 290px, (min-width: 640px) 112px, 50vw"
    : "(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw";
  // cover when cropping to the media area would remove at most ~20% of
  // the photo, contain otherwise; contain until the photo has loaded.
  const mediaRatio = board ? 3 / 2 : 4 / 3;
  const [fill, setFill] = useState<"cover" | "contain">("contain");

  // Class sets per part. `board-row:` = list row (tablet / phone 목록형),
  // `board-tile:` = phone 격자형 card; unprefixed = the desktop card.
  const c = board
    ? {
        root: "flex-col motion-safe:hover:-translate-y-0.5 board-row:flex-row board-row:gap-3 board-row:p-3 board-row:hover:translate-y-0",
        media:
          "aspect-3/2 w-full board-tile:aspect-4/3 board-row:size-20 board-row:shrink-0 board-row:rounded-lg board-row:min-[375px]:size-24 board-row:sm:size-28",
        backdrop: "board-row:hidden",
        photo: fill === "cover" ? "object-cover" : "object-contain board-row:object-cover",
        overlay: "inline-flex board-tile:top-1.5 board-tile:left-1.5 board-row:hidden",
        rowTile: "hidden board-row:flex",
        lineIcon: "flex board-row:hidden",
        lineStatus: hasPhoto ? "hidden board-row:inline-flex" : "",
        body: "gap-1 p-4 board-tile:gap-0.5 board-tile:p-2.5 board-row:gap-0.5 board-row:p-0 board-row:py-0.5",
        categoryText: "text-xs board-tile:text-[11px]",
        title: `text-[15px] board-tile:text-sm ${hasPhoto ? "min-h-[2lh] board-tile:min-h-0 board-row:min-h-0" : ""}`,
        desc: "line-clamp-3 text-sm leading-relaxed board-tile:text-xs board-tile:leading-snug board-row:line-clamp-1 board-row:text-xs board-row:sm:line-clamp-2",
        meta: "gap-x-1.5 pt-1.5 text-xs board-tile:flex-wrap board-tile:gap-y-0.5 board-tile:pt-1 board-tile:text-[11px] board-row:pt-1",
        location: "board-tile:basis-full",
        separator: "board-tile:hidden",
      }
    : {
        root: "h-full flex-col motion-safe:hover:-translate-y-0.5",
        media: "aspect-4/3 w-full shrink-0",
        backdrop: "",
        photo: fill === "cover" ? "object-cover" : "object-contain",
        overlay: "inline-flex",
        rowTile: "hidden",
        lineIcon: "flex",
        lineStatus: hasPhoto ? null : "",
        body: "gap-1 p-3 sm:p-3.5",
        categoryText: "text-xs",
        title: "text-[15px]",
        desc: "line-clamp-3 text-sm leading-relaxed",
        meta: "gap-x-1.5 pt-1.5 text-xs",
        location: "",
        separator: "",
      };

  return (
    // Phase P-4: one `transition` covers border-color, box-shadow and the
    // small hover lift together.
    <div
      {...(!hasPhoto && { "data-no-photo": "" })}
      className={`group relative flex min-w-0 overflow-hidden rounded-card border border-border bg-card transition duration-150 hover:border-primary/40 hover:shadow-md ${c.root}`}
    >
      {post.imageUrl ? (
        <div className={`relative overflow-hidden bg-muted ${c.media}`}>
          <Image
            src={post.imageUrl}
            alt=""
            aria-hidden="true"
            fill
            sizes={sizes}
            loading="lazy"
            className={`scale-110 object-cover opacity-50 blur-xl ${fill === "cover" ? "hidden" : c.backdrop}`}
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
            className={`transition-transform motion-safe:group-hover:scale-[1.03] ${c.photo}`}
          />
          {showStatus && (
            <span className={`absolute top-2 left-2 rounded-full bg-card shadow-sm ${c.overlay}`}>
              <StatusBadge status={post.status} compact />
            </span>
          )}
        </div>
      ) : (
        board && (
          // List row only: the category tile where the thumbnail would be.
          <div
            className={`size-20 shrink-0 items-center justify-center rounded-lg bg-primary-muted/70 min-[375px]:size-24 sm:size-28 ${c.rowTile}`}
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-card text-primary shadow-sm">{icon("size-5")}</span>
          </div>
        )
      )}

      <div className={`flex min-w-0 flex-1 flex-col ${c.body}`}>
        <div className="flex min-w-0 items-center gap-2">
          {!hasPhoto && (
            <span className={`size-7 shrink-0 items-center justify-center rounded-lg bg-primary-muted text-primary ${c.lineIcon}`}>
              {icon("size-4")}
            </span>
          )}
          <p className={`min-w-0 flex-1 truncate font-medium text-muted-foreground ${c.categoryText}`} data-post-category>
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
          {showStatus && c.lineStatus !== null && <StatusBadge status={post.status} compact className={c.lineStatus} />}
        </div>
        <h3 className={`line-clamp-2 leading-snug font-semibold text-foreground [overflow-wrap:anywhere] ${c.title}`}>{post.title}</h3>
        {!hasPhoto && description && <p className={`text-muted-foreground [overflow-wrap:anywhere] ${c.desc}`}>{description}</p>}
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
        <div className={`mt-auto flex min-w-0 items-center text-muted-foreground ${c.meta}`}>
          <span className={`flex min-w-0 items-center gap-1 ${c.location}`}>
            <PinIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{post.location ?? t("post.locationUnknown")}</span>
          </span>
          <span aria-hidden="true" className={`shrink-0 text-border ${c.separator}`}>
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
