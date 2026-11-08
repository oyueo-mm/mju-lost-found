import { listFoundPosts, type PostDTO } from "@/lib/posts/service";
import { PostCard } from "@/components/post/PostCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { SEARCH_RESULTS_GRID_CLASS } from "@/components/search/resultsLayout";
import { getTranslator } from "@/lib/i18n/server";

// Reuse the home's public found-post listing, without AI inference or a new
// recommendation algorithm. The separate recent-post sections stay intact.
export async function HomeHeroRecommendations() {
  const t = await getTranslator();
  let posts: PostDTO[];
  try { posts = (await listFoundPosts({ page: 1, limit: 6 })).items; }
  catch { return <p className="text-sm text-muted-foreground">{t("home.recentFound.error")}</p>; }
  return (
    <div className="flex min-w-0 flex-col gap-3" data-home-recommendations>
      <h2 className="text-sm font-semibold text-foreground">{t("recommend.title")}</h2>
      {posts.length ? <div className={SEARCH_RESULTS_GRID_CLASS}>
        {posts.map((post) => <PostCard key={`${post.type}-${post.id}`} post={post} variant="list" hideEmptyThumbnail scoreDisplay="hidden" />)}
      </div> : <EmptyState title={t("board.found.empty.title")} description={t("board.found.empty.description")} />}
    </div>
  );
}
