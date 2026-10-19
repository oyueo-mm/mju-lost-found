import { listFoundPosts, listLostPosts, type PostDTO } from "@/lib/posts/service";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/Button";
import { getTranslator } from "@/lib/i18n/server";
import { RecentPostsCarousel, type SlidePost } from "./RecentPostsCarousel";

// 최근 분실물 / 최근 습득물 on the home, signed in or out: the newest posts
// of each board (the same listLostPosts()/listFoundPosts() the boards use,
// page 1, newest first) as a slowly drifting card row (RecentPostsCarousel).
// Only what a card shows is sent to the browser.
const RECENT_LIMIT = 12;

const toSlide = (post: PostDTO): SlidePost => ({
  id: post.id,
  type: post.type,
  title: post.title,
  imageUrl: post.imageUrl,
  createdAt: post.createdAt,
  status: post.status,
  category: post.category,
  categoryCode: post.categoryCode ?? null,
});

export async function RecentPostsSections() {
  const t = await getTranslator();
  let lost: SlidePost[] | null = null;
  let found: SlidePost[] | null = null;
  try {
    const [l, f] = await Promise.all([listLostPosts({ page: 1, limit: RECENT_LIMIT }), listFoundPosts({ page: 1, limit: RECENT_LIMIT })]);
    lost = l.items.map(toSlide);
    found = f.items.map(toSlide);
  } catch (error) {
    console.error("Failed to load recent posts for Home", error);
  }

  const boards = [
    { type: "lost", title: t("home.recentLost"), posts: lost, error: t("home.recentLost.error") },
    { type: "found", title: t("home.recentFound"), posts: found, error: t("home.recentFound.error") },
  ] as const;

  return (
    <>
      {boards.map((b) => (
        <ScrollReveal key={b.type} className="flex flex-col gap-4">
          <SectionHeader title={b.title} href={`/${b.type}`} centered titleClassName="text-xl md:text-2xl" />
          {b.posts === null ? (
            <p className="text-sm text-muted-foreground">{b.error}</p>
          ) : b.posts.length === 0 ? (
            <EmptyState
              title={t(`board.${b.type}.empty.title`)}
              description={t(`board.${b.type}.empty.description`)}
              action={<LinkButton href={`/${b.type}/new`}>{t(`board.${b.type}.newCta`)}</LinkButton>}
            />
          ) : (
            <RecentPostsCarousel posts={b.posts} label={b.title} />
          )}
        </ScrollReveal>
      ))}
    </>
  );
}
