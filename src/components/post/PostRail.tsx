import type { PostDTO } from "@/lib/posts/service";
import { PostCard } from "./PostCard";

// Phase 17: Home's "최근 분실물/최근 습득물" card rail -- a horizontally
// scrollable strip on narrow screens (each card gets a fixed width so the
// row can scroll instead of squeezing into an unreadably-narrow grid
// column) that becomes a plain grid at sm+ where there's room for it. The
// scroll strip itself never causes *page*-level horizontal overflow (only
// this element scrolls, via overflow-x-auto + shrink-0 children).
export function PostRail({ posts }: { posts: PostDTO[] }) {
  return (
    <div className="scroll-rail -mx-4 flex gap-3 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:px-0 lg:grid-cols-3">
      {posts.map((post) => (
        <div key={`${post.type}-${post.id}`} className="w-40 shrink-0 sm:w-auto">
          <PostCard post={post} />
        </div>
      ))}
    </div>
  );
}
