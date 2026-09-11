import type { PostDTO } from "@/lib/posts/service";
import { PostCard } from "./PostCard";

// Phase 17: Home's "최근 분실물/최근 습득물" card rail -- a horizontally
// scrollable strip on narrow screens (each card gets a fixed width so the
// row can scroll instead of squeezing into an unreadably-narrow grid
// column) that becomes a plain grid at sm+ where there's room for it. The
// scroll strip itself never causes *page*-level horizontal overflow (only
// this element scrolls, via overflow-x-auto + shrink-0 children).
//
// PostCard 게시판 레이아웃 통일 Phase: /lost, /found는 PostCard를 grid의
// 직접 자식으로 두기 때문에, grid의 기본 align-items: stretch가 PostCard
// 자신의(테두리가 그려지는) 루트 엘리먼트를 곧장 그 행의 높이로 늘려준다
// -- 그래서 사진 있는/없는 카드가 섞여도 한 행 안에서는 테두리 높이가
// 맞는다. 반면 이 컴포넌트는 PostCard를 한 번 더 일반 block div로 감싸고
// 있었는데, 그 래퍼는 stretch를 전달만 받고 자기 자식(PostCard)에게
// 다시 물려주지 않는다 -- 래퍼 자체는 행 높이만큼 늘어나지만 그 안의
// PostCard는 여전히 자기 내용만큼의 높이로만 렌더링되어, 홈에서만 카드
// 테두리 높이가 서로 달라 보이는 원인이었다. 래퍼에 flex를 추가해 그
// 자신도 flex 컨테이너가 되게 하면(기본 align-items: stretch), 하나뿐인
// 자식인 PostCard가 래퍼의 늘어난 높이를 그대로 물려받는다 -- /lost,
// /found와 동일한 "그리드/행이 직접 PostCard를 늘린다"는 결과를
// 유지하면서, 래퍼 div 자체(고정 너비를 위해 필요)는 그대로 둔다.
// [&>*]:w-full은 flex row에서 자식 하나짜리 아이템이 가로축(main axis)
// 으로는 기본적으로 내용 크기만큼만 차지하는 문제(세로축 stretch와
// 별개)를 막아, 기존 w-40/sm:w-auto 너비를 PostCard가 그대로 100%
// 채우게 한다. PostCard.tsx 자체는 전혀 건드리지 않는다.
export function PostRail({ posts }: { posts: PostDTO[] }) {
  return (
    <div className="scroll-rail -mx-4 flex gap-3 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:px-0 lg:grid-cols-3">
      {posts.map((post) => (
        <div key={`${post.type}-${post.id}`} className="flex w-40 shrink-0 [&>*]:w-full sm:w-auto">
          <PostCard post={post} />
        </div>
      ))}
    </div>
  );
}
