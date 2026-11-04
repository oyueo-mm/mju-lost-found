import { listFoundPosts, listLostPosts, type PostDTO } from "@/lib/posts/service";
import { PostCard } from "@/components/post/PostCard";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/Button";
import { getTranslator } from "@/lib/i18n/server";

// 최근 습득물 / 최근 분실물 on the home, signed in or out: the newest posts
// of each board (the same listFoundPosts()/listLostPosts() the boards use,
// page 1, newest first) as the board's own list rows -- text left, photo
// right, a hairline between rows (PostCard variant="board"). Two columns on
// a laptop, stacked on a phone; always rows, whatever view a phone picked
// for the boards (data-force-list).
const RECENT_LIMIT = 5;

export async function RecentPostsSections() {
  const t = await getTranslator();
  let lost: PostDTO[] | null = null;
  let found: PostDTO[] | null = null;
  try {
    const [l, f] = await Promise.all([listLostPosts({ page: 1, limit: RECENT_LIMIT }), listFoundPosts({ page: 1, limit: RECENT_LIMIT })]);
    lost = l.items;
    found = f.items;
  } catch (error) {
    console.error("Failed to load recent posts for Home", error);
  }

  const boards = [
    { type: "found", title: t("home.recentFound"), posts: found, error: t("home.recentFound.error") },
    { type: "lost", title: t("home.recentLost"), posts: lost, error: t("home.recentLost.error") },
  ] as const;

  return (
    <div data-force-list className="grid gap-10 lg:grid-cols-2 lg:gap-x-12">
      {boards.map((b) => (
        <ScrollReveal key={b.type} className="flex min-w-0 flex-col gap-1">
          <SectionHeader title={b.title} href={`/${b.type}`} titleClassName="text-lg md:text-xl" />
          {b.posts === null ? (
            <p className="py-4 text-sm text-muted-foreground">{b.error}</p>
          ) : b.posts.length === 0 ? (
            <EmptyState
              title={t(`board.${b.type}.empty.title`)}
              description={t(`board.${b.type}.empty.description`)}
              action={<LinkButton href={`/${b.type}/new`}>{t(`board.${b.type}.newCta`)}</LinkButton>}
            />
          ) : (
            <div className="mt-2 flex flex-col border-t border-border">
              {b.posts.map((post) => (
                <PostCard key={post.id} post={post} variant="board" />
              ))}
            </div>
          )}
        </ScrollReveal>
      ))}
    </div>
  );
}
