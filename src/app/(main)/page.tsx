import { getCurrentUser } from "@/lib/auth/session";
import { listLostPosts, listFoundPosts } from "@/lib/posts/service";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { CategoryShortcuts } from "@/components/home/CategoryShortcuts";
import { LandingHero } from "@/components/home/LandingHero";
import { Hero } from "@/components/home/landing/Hero";
import { LandingStats } from "@/components/home/landing/LandingStats";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { PostRail } from "@/components/post/PostRail";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/Button";
import { getTranslator } from "@/lib/i18n/server";

const RECENT_LIMIT = 6;

// Home. Public, no auth gate: the session only decides what follows the
// first screen.
//
// Both start with the same first screen, so signing in never feels like
// arriving at another service: Hero (the two-line headline, the one-line
// subtitle, the AI search with its popular searches, the blue glow, and the
// 분실물·습득물 등록 buttons -- signed out, those go through sign-in and back to
// the form; signed in, straight to the form), then LandingStats (the real
// registration counts and the links into the two boards).
//
// - Signed out: the landing story continues (LandingHero: features and the
//   demos of posting, AI search, matching).
// - Signed in: what a member comes back for -- category shortcuts and the
//   newest lost / found posts (the same listLostPosts()/listFoundPosts()
//   every board uses, page 1, newest first).
//
// The search itself is unchanged: AI search over found posts
// (HomeSearchBar); the mode toggle and board choice stay on /search,
// /lost and /found.
export default async function Home() {
  const [user, t] = await Promise.all([getCurrentUser(), getTranslator()]);
  if (!user) {
    return <LandingHero />;
  }

  let recentLost: Awaited<ReturnType<typeof listLostPosts>> | null = null;
  let recentFound: Awaited<ReturnType<typeof listFoundPosts>> | null = null;
  try {
    [recentLost, recentFound] = await Promise.all([
      listLostPosts({ page: 1, limit: RECENT_LIMIT }),
      listFoundPosts({ page: 1, limit: RECENT_LIMIT }),
    ]);
  } catch (error) {
    console.error("Failed to load recent posts for Home", error);
  }

  return (
    <div className="flex flex-col">
      <Hero />
      <LandingStats />

      {/* Each section below fades up the first time it's scrolled to
          (ScrollReveal -- no-op for content already on screen and for
          prefers-reduced-motion). */}
      <div className="flex flex-col gap-10 pt-6 md:pt-8">
        <ScrollReveal className="flex flex-col gap-4 text-center">
          <h2 className="text-lg font-semibold text-foreground">{t("home.categories.title")}</h2>
          <CategoryShortcuts />
        </ScrollReveal>

        <ScrollReveal className="flex flex-col gap-4">
          <SectionHeader title={t("home.recentLost")} href="/lost" centered titleClassName="text-xl md:text-2xl" />
          {recentLost === null ? (
            <p className="text-sm text-muted-foreground">{t("home.recentLost.error")}</p>
          ) : recentLost.items.length === 0 ? (
            <EmptyState
              title={t("board.lost.empty.title")}
              description={t("board.lost.empty.description")}
              action={<LinkButton href="/lost/new">{t("board.lost.newCta")}</LinkButton>}
            />
          ) : (
            <PostRail posts={recentLost.items} />
          )}
        </ScrollReveal>

        <ScrollReveal className="flex flex-col gap-4">
          <SectionHeader title={t("home.recentFound")} href="/found" centered titleClassName="text-xl md:text-2xl" />
          {recentFound === null ? (
            <p className="text-sm text-muted-foreground">{t("home.recentFound.error")}</p>
          ) : recentFound.items.length === 0 ? (
            <EmptyState
              title={t("board.found.empty.title")}
              description={t("board.found.empty.description")}
              action={<LinkButton href="/found/new">{t("board.found.newCta")}</LinkButton>}
            />
          ) : (
            <PostRail posts={recentFound.items} />
          )}
        </ScrollReveal>
      </div>
    </div>
  );
}
