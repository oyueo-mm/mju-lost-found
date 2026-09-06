import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/session";
import { listLostPosts, listFoundPosts } from "@/lib/posts/service";
import { HomeSearchBar } from "@/components/home/HomeSearchBar";
import { CategoryShortcuts } from "@/components/home/CategoryShortcuts";
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
export default async function Home() {
  const user = await getCurrentUser();

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
        <div className="w-full max-w-xl">
          <HomeSearchBar />
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

      {!user && (
        <section className="flex flex-col items-start gap-3 rounded-card border border-border bg-muted/60 p-6">
          <p className="text-sm text-muted-foreground">
            명지대학교 학생들을 위한 분실물 · 습득물 서비스입니다. 게시글 작성, 채팅 등을 이용하려면
            로그인해주세요.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <LinkButton href="/login">Google로 로그인하기</LinkButton>
            <Link href="/account-guide" className="text-sm text-muted-foreground underline hover:text-foreground">
              명지대 계정이 없으신가요?
            </Link>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-foreground">어떤 물건을 찾고 있나요?</h2>
        <CategoryShortcuts />
      </section>

      <section className="flex flex-col gap-4">
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
      </section>

      <section className="flex flex-col gap-4">
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
      </section>
    </div>
  );
}
