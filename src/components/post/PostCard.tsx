"use client";

import Image from "next/image";
import Link from "next/link";

import type { PostDTO } from "@/lib/posts/service";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { AttributionLink } from "@/components/user/AttributionLink";
import { PinIcon, ClockIcon, EyeIcon } from "@/components/icons";
import { useI18n } from "@/lib/i18n/client";
import { LOCALE_INTL_TAG } from "@/lib/i18n/config";
import { postTypeLabelKey } from "@/lib/i18n/labels";
import type { Locale } from "@/lib/i18n/config";

function formatDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALE_INTL_TAG[locale], {
    dateStyle: "medium",
    timeZone: "Asia/Seoul",
  }).format(date);
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
  // AI 검색 고도화 Phase: replaces the old boolean `showPercentage` with a
  // three-way choice, since this project settled on two genuinely
  // different display *shapes* for `score`, not just "percentage or not":
  //
  // - "percentage": search/image search's `score` is a direct, stable
  //   rescale of raw cosine similarity (vectorSearch.ts's normalizeScore,
  //   `(cosine+1)/2`) -- comparable across different searches, so "XX%"
  //   is meaningful there. This is the default (every pre-existing caller
  //   using the old default is unaffected).
  // - "decimal": AI 검색 고도화 Phase's own requirement -- AI 검색 결과와
  //   게시글 상세 AI 추천은 이제 "AI 유사도 0.87"처럼 소수 두 자리로
  //   표시한다("87%"/"87점"/확률 표현 금지, see this phase's spec). Used
  //   by both AI 검색(AISearchPanel) and the post-detail AI recommendation
  //   (SimilarPostsSection) -- the latter's score, once combined with an
  //   image signal, is recommendation/service.ts's (now shared via
  //   rankFusion.ts) min-max-normalized-and-averaged value, not raw
  //   cosine -- but that's the exact same shape searchPostsAI's combined
  //   path produces (rankFusion.combineRankings), so "AI 유사도" reads
  //   consistently in both places.
  // - "hidden": no badge at all, even though `post.score` is present --
  //   only the "분실물 작성 직후" auto-recommendation view uses this (see
  //   PendingRecommendations/SimilarPostsSection's own `showScore`), so a
  //   just-created post's recommendations read as pure suggestions
  //   ("AI가 찾아본 비슷한 습득물"), never a numeric claim.
  scoreDisplay?: "percentage" | "decimal" | "hidden";
};

// Phase 17 redesign history (image-forward vertical card) and Phase H-3/H-6
// (aspect ratio tuned to 4:5 mobile / 4:3 desktop, then later reduced --
// see the PostCard 이미지 영역 UX 개선 Phase note below) shaped the fixed
// aspect-ratio + object-cover thumbnail this card still uses whenever a
// post has an image; see post/[id]/page.tsx's own comment for why the
// *detail* page deliberately does NOT crop the same way (a grid card and a
// single full-size detail view have different needs).
//
// PostCard 레이아웃 순서 개선 Phase: 카드가 항상 "이미지 -> 텍스트" 순서로
// 쌓이던 이전 구조는 이미지 유무에 따라 제목/배지가 시작되는 세로 위치
// 자체가 카드마다 달라지는 문제가 있었다(사진이 있으면 텍스트가 이미지
// 높이만큼 아래에서 시작, 없으면 맨 위에서 시작). 이번 수정으로 순서를
// "텍스트 -> 이미지(있을 때만)"로 뒤집었다:
// - 유형/상태 배지, 작성자/단체, 제목, 위치/시간/조회수, 유사도 배지 등
//   기존 게시글 정보는 이제 항상 카드 맨 위의 텍스트 영역에 먼저
//   배치되고, 이미지 유무와 무관하게 시작 위치가 완전히 동일하다.
// - 이미지가 있으면 텍스트 영역 *아래*에 기존과 같은 축소 비율(3:2,
//   md:16:10) 썸네일이 이어서 나온다. 이미지가 없으면 그 자리에는(이후
//   PostCard description 미리보기 Phase에서) description 미리보기를
//   보여준다 -- 그마저 없으면(공백뿐인 description) 아무것도 렌더링하지
//   않고(placeholder 없음) 카드는 텍스트 영역에서 그대로 끝난다.
// - 유형/상태 배지가 이제 이미지 유무와 상관없이 항상 텍스트 영역의 같은
//   자리에 있으므로, 예전에 이미지 위에 얹혀 있던 절대 위치 배지
//   (bg-card/90 backdrop-blur 스타일)는 더 이상 필요 없어 제거했다 --
//   같은 정보를 두 군데에 중복 표시하지 않는다.
// - 카드 높이가 이미지 유무에 따라 자연히 달라지는 것은 이제 의도된
//   동작이다(텍스트가 시작하는 위치는 항상 같고, 이미지가 있는 카드만 그
//   아래로 더 길어진다) -- 그래서 이전에 높이를 억지로 맞추려 썼던 루트의
//   `self-start` 제거/텍스트 영역의 `justify-center`는 더 이상 쓰지
//   않는다. 텍스트는 항상 위에서부터 자연스러운 순서로 쌓인다(플레인
//   flex-col, 별도 정렬 지정 없음).
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
export function PostCard({ post, scoreLabel, scoreDisplay = "percentage" }: PostCardProps) {
  const { locale, t } = useI18n();
  // 기본 라벨("검색 유사도")은 이제 호출자가 문자열을 넘기지 않았을 때
  // 여기서 번역해 채운다 -- 기존 기본값의 의미는 그대로다.
  const resolvedScoreLabel = scoreLabel ?? t("post.score.search");

  return (
    // Phase P-4: `transition` (not `transition-colors`) so border-color,
    // box-shadow, and the small hover lift below all animate off the same
    // single transition-property list -- stacking two transition-*
    // utilities on one element is unreliable in Tailwind (whichever rule
    // lands last in the generated stylesheet wins, not necessarily the
    // one written last in this className), so this uses the one utility
    // that already covers all three instead. Kept short (existing
    // duration-150 default) and subtle -- a hint of depth, not a jump.
    <div className="group relative flex flex-col overflow-hidden rounded-card border border-border bg-card transition duration-150 hover:border-foreground/30 hover:shadow-md motion-safe:hover:-translate-y-0.5">
      <div className="flex min-w-0 flex-col gap-1.5 p-3.5">
        {/* 유형/상태 배지 -- 이미지 유무와 상관없이 항상 텍스트 영역
            맨 위에 있다. Phase G-2: on /search (mixed 분실물+습득물
            results), the status badge alone ("찾는 중"/"보관 중") only
            implies which board a card belongs to -- the type label makes
            it explicit. Harmless on /lost and /found too (board is
            already fixed there by the page itself), so it's shown
            unconditionally rather than threading a new prop through every
            PostCard call site just to hide it there. */}
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
            {t(postTypeLabelKey(post.type))}
          </span>
          <StatusBadge status={post.status} />
        </div>
        {/* Phase 12-8 §2/§3: organization-attributed posts show ONLY the
            organization here -- the real author's nickname/publicId is
            never rendered for those (AttributionLink's own comment). A
            personal post renders exactly like the old plain AuthorLink. */}
        <AttributionLink
          organizationId={post.organizationId}
          organizationName={post.organizationName}
          author={post.author}
          className={
            post.organizationId != null
              ? "relative z-10 text-xs font-medium text-primary hover:underline"
              : "relative z-10 w-fit truncate text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
          }
        />
        {/* 제목 시각적 위계 강화 Phase: 카드에서 제목이 가장 먼저 눈에
            들어오도록 text-sm/font-semibold/1줄(truncate)에서 text-base/
            font-bold/최대 2줄(line-clamp-2)로 강화했다 -- 색상은 이미
            이 컴포넌트의 다른 모든 텍스트(text-muted-foreground)보다
            진한 text-foreground를 쓰고 있어 그대로 유지(디자인
            시스템에 이보다 더 강한 텍스트 색 토큰이 없다). 제목과 바로
            아래 위치/시간/조회수 메타 블록 사이만 mb-1을 더해 간격을
            넓혔다(다른 요소 간 gap-1.5는 그대로). 사진 유무 분기와
            무관하게 이 h3 하나만 쓰이므로 두 카드 형태 모두 자동으로
            같은 제목 스타일을 공유한다. */}
        <h3 className="mb-1 line-clamp-2 text-base font-bold text-foreground">{post.title}</h3>
        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1 truncate">
            <PinIcon className="size-3.5 shrink-0" />
            <span className="truncate">{post.location ?? t("post.locationUnknown")}</span>
          </span>
          <span className="flex items-center gap-1">
            <ClockIcon className="size-3.5 shrink-0" />
            {formatDate(post.createdAt, locale)}
          </span>
          {/* Phase 31: same EyeIcon+count pattern as post/[id]/page.tsx's
              own view-count display -- reuses the existing viewCount DTO
              field, no new data source. */}
          <span className="flex items-center gap-1">
            <EyeIcon className="size-3.5 shrink-0" />
            {post.viewCount}
          </span>
        </div>
        {/* Phase 12/15-2/AI 검색 고도화: only present on a similarity-ranked
            result (search results, or the post detail page's AI
            recommendations) -- a plain keyword-search/list result never
            carries `score`, so this never shows up outside those contexts.
            Always labeled by the caller ("검색 유사도"/"이미지 유사도"/
            "AI 유사도", see scoreLabel above). scoreDisplay picks the
            *shape*: "percentage" (search/image search's stable cosine
            rescale), "decimal" (AI 검색/AI 추천's "AI 유사도 0.87" -- see
            scoreDisplay's own comment above for why this is never ×100),
            or "hidden" (no badge at all, regardless of scoreLabel --
            the just-created-post auto-recommendation view). */}
        {typeof post.score === "number" && scoreDisplay !== "hidden" && (
          <span className="mt-0.5 w-fit rounded-full bg-primary-muted px-2 py-0.5 text-[11px] font-medium text-primary">
            {scoreDisplay === "decimal"
              ? `${resolvedScoreLabel} ${post.score.toFixed(2)}`
              : `${resolvedScoreLabel} ${Math.round(post.score * 100)}%`}
          </span>
        )}
      </div>

      {/* PostCard description 미리보기 Phase: 이미지가 있으면 기존과
          동일하게 텍스트 영역 아래에 축소 비율(3:2, md:16:10) 썸네일을
          보여준다(placeholder 없음, 그대로 유지). 이미지가 없으면 그
          자리를 비워두는 대신 description 미리보기로 채운다 -- 분실물
          게시판처럼 사진 없는 글이 많은 목록에서 카드가 휑해 보이지 않고
          물건의 특징/상황이 바로 보이도록 하기 위함이다. description도
          없는(빈 문자열/공백만 있는) 극히 드문 경우는 억지 placeholder
          문구 없이 그 영역을 그냥 비운다 -- "이미지 없음" 같은 자리
          채우기 문구는 이전 Phase에서 이미 없앴고, 여기서도 새로 만들지
          않는다. 카드 상단 텍스트 영역에는 원래 description이 전혀
          렌더링되지 않았으므로(제목만 표시) 이 미리보기와 중복될 내용이
          없다. line-clamp-4로 길이를 제한해 카드가 지나치게 길어지지
          않게 한다. */}
      {post.imageUrl ? (
        <div className="relative aspect-3/2 w-full shrink-0 overflow-hidden bg-muted md:aspect-16/10">
          <Image
            src={post.imageUrl}
            alt={post.title}
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
            loading="lazy"
            className="object-cover transition-transform motion-safe:group-hover:scale-[1.03]"
          />
        </div>
      ) : (
        post.description.trim() && (
          <p className="line-clamp-4 border-t border-border px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
            {post.description}
          </p>
        )
      )}

      <Link href={`/post/${post.id}?type=${post.type}`} aria-label={post.title} className="absolute inset-0" />
    </div>
  );
}
