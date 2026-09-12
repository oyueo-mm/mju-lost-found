"use client";

import type { PostType } from "@/lib/posts/schema";
import type { PostDTO } from "@/lib/posts/service";
import { PostCard } from "@/components/post/PostCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { useI18n } from "@/lib/i18n/client";
import { postTypeLabelKey } from "@/lib/i18n/labels";

// Lost 게시글에는 습득물을, 습득물 게시글에는 분실물을 -- 이 앱의 모든
// AI 랭킹 기능이 이미 쓰는 교차 게시판 관례 그대로.
const OPPOSITE_TYPE: Record<PostType, PostType> = { lost: "found", found: "lost" };

type SimilarPostsSectionProps = {
  sourceType: PostType;
  recommendations: PostDTO[];
  loadFailed: boolean;
  // Phase 11-2: true only while PendingRecommendations.tsx is still
  // polling for a freshly-created post's recommendations (its embedding
  // is computed in the background, see aiService.ts's createLostPost/
  // createFoundPost) -- shows a distinct "준비 중" message instead of the
  // normal empty state, so a brand-new post doesn't look like it simply
  // has no matches yet. Every existing caller omits this (defaults to
  // false) and renders exactly as before.
  pending?: boolean;
  // AI 검색 고도화 Phase: false only for the "분실물/습득물 작성 직후"
  // auto-recommendation view (PendingRecommendations passes
  // `!pollForResults`'s own inverse -- see that component) -- this phase's
  // spec explicitly requires that view to stay pure suggestions with no
  // numeric score ("AI가 찾아본 비슷한 습득물"), while every other,
  // *later* visit to the same post detail page shows "AI 유사도 0.xx" on
  // each card (see PostCard's scoreDisplay). Every existing caller omits
  // this (defaults to true) -- a plain page revisit is unaffected.
  showScore?: boolean;
};

// Phase J-2: was an interactive client widget where the viewer picked a
// mode (자연어/이미지) and typed a query or uploaded a photo. Now it just
// renders what the page already computed from *this* post's own stored
// embeddings (src/lib/recommendation/service.ts) -- no mode selector, no
// query input, no client-side fetch, so it needs no "use client" at all.
// The user-facing "Match"/"매칭하기"/"비슷한 게시물 찾기" vocabulary is gone
// with it: one "AI 추천" concept, and the existing 채팅하기 button above is
// still how you contact the other person (no confirmation step in
// between). Keyword/semantic/image *search* is untouched and still lives
// on /lost, /found and /search.
export function SimilarPostsSection({
  sourceType,
  recommendations,
  loadFailed,
  pending = false,
  showScore = true,
}: SimilarPostsSectionProps) {
  const { t } = useI18n();
  const targetType = OPPOSITE_TYPE[sourceType];
  // 다국어(i18n) Phase: 예전 BOARD_LABEL 상수(하드코딩된 "분실물"/"습득물")
  // 대신 PostCard/게시글 상세와 같은 postTypeLabelKey를 쓴다 -- 같은 두
  // 단어가 화면마다 다르게 번역되지 않도록 매핑을 한 곳에만 둔다.
  const boardLabel = t(postTypeLabelKey(targetType));

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold text-foreground">{t("recommend.title")}</h2>
        <p className="text-xs text-muted-foreground">{t("recommend.description", { board: boardLabel })}</p>
      </div>

      {loadFailed ? (
        <p className="text-sm text-destructive">{t("recommend.error")}</p>
      ) : recommendations.length === 0 && pending ? (
        <div className="flex items-center gap-2 rounded-card border border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
          <span
            aria-hidden="true"
            className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground motion-reduce:animate-none"
          />
          {t("recommend.pending")}
        </div>
      ) : recommendations.length === 0 ? (
        <EmptyState
          title={t("recommend.empty.title", { board: boardLabel })}
          description={t("recommend.empty.description", { board: boardLabel })}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {recommendations.map((post) => (
            // AI 검색 고도화 Phase: shows "AI 유사도 0.xx" (scoreDisplay=
            // "decimal", see PostCard's own comment on why this is never
            // ×100 -- it's recommendation/service.ts's min-max-normalized,
            // then averaged score, the exact same shape AI 검색's combined
            // text+image path produces via the shared rankFusion module),
            // except on the just-created-post auto-recommendation view
            // (showScore=false, see this component's own prop comment),
            // where the badge is hidden entirely instead.
            <PostCard
              key={`${post.type}-${post.id}`}
              post={post}
              scoreLabel={t("post.score.ai")}
              scoreDisplay={showScore ? "decimal" : "hidden"}
            />
          ))}
        </div>
      )}
    </div>
  );
}
