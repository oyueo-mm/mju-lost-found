import type { PostType } from "@/lib/posts/schema";
import type { PostDTO } from "@/lib/posts/service";
import { PostCard } from "@/components/post/PostCard";
import { EmptyState } from "@/components/ui/EmptyState";

// Lost 게시글에는 습득물을, 습득물 게시글에는 분실물을 -- 이 앱의 모든
// AI 랭킹 기능이 이미 쓰는 교차 게시판 관례 그대로.
const OPPOSITE_TYPE: Record<PostType, PostType> = { lost: "found", found: "lost" };
const BOARD_LABEL: Record<PostType, string> = { lost: "분실물", found: "습득물" };

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
}: SimilarPostsSectionProps) {
  const targetType = OPPOSITE_TYPE[sourceType];

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold text-foreground">AI 추천</h2>
        <p className="text-xs text-muted-foreground">
          이 게시글과 관련된 {BOARD_LABEL[targetType]}을 AI가 추천해요. 실제 동일 물건 여부를 보장하지는 않아요.
        </p>
      </div>

      {loadFailed ? (
        <p className="text-sm text-destructive">추천을 불러오는 중 문제가 발생했습니다.</p>
      ) : recommendations.length === 0 && pending ? (
        <div className="flex items-center gap-2 rounded-card border border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
          <span
            aria-hidden="true"
            className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground motion-reduce:animate-none"
          />
          AI 추천을 준비하고 있어요. 잠시 후 이 화면에 자동으로 표시돼요.
        </div>
      ) : recommendations.length === 0 ? (
        <EmptyState
          title={`추천할 ${BOARD_LABEL[targetType]}이 아직 없어요.`}
          description={`관련된 ${BOARD_LABEL[targetType]} 게시글이 등록되면 여기에 표시돼요.`}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {recommendations.map((post) => (
            // score는 텍스트/이미지 신호를 합친 값이라 "검색 유사도"도
            // "이미지 유사도"도 아니다 -- 어느 신호가 기여했든 정확한 하나의
            // 이름으로 "추천도"를 쓴다 (PostCard의 scoreLabel 주석 참고).
            <PostCard key={`${post.type}-${post.id}`} post={post} scoreLabel="추천도" />
          ))}
        </div>
      )}
    </div>
  );
}
