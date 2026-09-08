import { getCurrentUser } from "@/lib/auth/session";
import { listLostPosts, listFoundPosts } from "@/lib/posts/service";
import { StickyHomeSearch } from "@/components/home/StickyHomeSearch";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { CategoryShortcuts } from "@/components/home/CategoryShortcuts";
import { LandingHero } from "@/components/home/LandingHero";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { PostRail } from "@/components/post/PostRail";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/Button";
import { BoxIcon, HandboxIcon } from "@/components/icons";

const RECENT_LIMIT = 6;

// Phase 17: Home redesigned from a bare link-list into the product's
// landing/dashboard page (this phase's own primary goal) -- public, no
// auth gate (getCurrentUser() only decides whether the logged-out CTA
// renders, same "read the session, never redirect" pattern used since
// Phase 14). Recent Lost/Found sections call the exact same
// listLostPosts()/listFoundPosts() every board page already uses (no new
// query, no mock data) with page=1/limit=6 -- newest-first is already
// buildOrderBy()'s default with no `sort` filter given.
//
// Phase 29: a logged-out visitor sees LandingHero instead -- a first-time
// stranger needs "what is this service" answered before a dashboard full
// of today's posts means anything. Everything below this check (the
// search bar, recent-posts rails, etc.) is exactly what a logged-in user
// already saw before this phase; nothing there changed.
export default async function Home() {
  const user = await getCurrentUser();
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
    <div className="flex flex-col gap-12">
      {/* Hero -- kept to one viewport-friendly section (no full-height
          hero): headline + one-line subcopy + search, so the first
          scroll's worth of the page already contains the app's single
          most important action. */}
      <section className="flex flex-col items-center gap-5 py-4 text-center md:py-8">
        <h1 className="text-2xl leading-snug font-bold text-balance text-foreground md:text-3xl">
          명지대학교 분실물 센터
          <br />
          <span className="text-primary">잃어버린 물건</span>, 여기서 찾아보세요
        </h1>
        <p className="text-sm text-muted-foreground md:text-base">
          비슷한 물건까지 자동으로 찾아드려요 · 캠퍼스 안에서 안전하게 주고받으세요
        </p>
        {/* Phase K: same hero search as before, plus a compact copy that
            slides in under the Header once this one scrolls away -- so
            search stays reachable while browsing the rails below without
            scrolling back up. See StickyHomeSearch. */}
        <div className="w-full max-w-xl">
          <StickyHomeSearch />
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <LinkButton href="/lost" variant="secondary" size="sm" className="gap-1.5">
            <BoxIcon className="size-4" /> 분실물 찾기
          </LinkButton>
          <LinkButton href="/found" variant="secondary" size="sm" className="gap-1.5">
            <HandboxIcon className="size-4" /> 습득물 보기
          </LinkButton>
        </div>
      </section>

      {/* Phase K: each section below the hero fades up the first time it's
          scrolled to (ScrollReveal -- no-op for content already on screen
          and for prefers-reduced-motion). Contents are unchanged. */}
      <ScrollReveal className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-foreground">어떤 물건을 찾고 있나요?</h2>
        <CategoryShortcuts />
      </ScrollReveal>

      <ScrollReveal className="flex flex-col gap-4">
        <SectionHeader title="최근 분실물" href="/lost" />
        {recentLost === null ? (
          <p className="text-sm text-muted-foreground">최근 분실물을 불러오지 못했습니다.</p>
        ) : recentLost.items.length === 0 ? (
          <EmptyState
            title="아직 등록된 분실물이 없어요."
            description="가장 먼저 물건을 등록해보세요."
            action={<LinkButton href="/lost/new">분실물 등록하기</LinkButton>}
          />
        ) : (
          <PostRail posts={recentLost.items} />
        )}
      </ScrollReveal>

      <ScrollReveal className="flex flex-col gap-4">
        <SectionHeader title="최근 습득물" href="/found" />
        {recentFound === null ? (
          <p className="text-sm text-muted-foreground">최근 습득물을 불러오지 못했습니다.</p>
        ) : recentFound.items.length === 0 ? (
          <EmptyState
            title="아직 등록된 습득물이 없어요."
            description="주운 물건을 등록해서 주인을 찾아주세요."
            action={<LinkButton href="/found/new">습득물 등록하기</LinkButton>}
          />
        ) : (
          <PostRail posts={recentFound.items} />
        )}
      </ScrollReveal>
    </div>
  );
}
