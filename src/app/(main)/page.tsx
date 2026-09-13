import { getCurrentUser } from "@/lib/auth/session";
import { listLostPosts, listFoundPosts } from "@/lib/posts/service";
import { HomeSearchBar } from "@/components/home/HomeSearchBar";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { CategoryShortcuts } from "@/components/home/CategoryShortcuts";
import { LandingHero } from "@/components/home/LandingHero";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { PostRail } from "@/components/post/PostRail";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/Button";
import { BoxIcon, HandboxIcon } from "@/components/icons";
import { getTranslator } from "@/lib/i18n/server";

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
// of today's posts means anything.
//
// 홈 검색 선택 UI 정리 Phase: 이 화면에서 바뀐 것은 딱 하나, "검색하기
// 전에 골라야 하는 것"이 없어진 것이다. 예전에는 검색창 위에 AI/키워드
// 토글과 검색 대상(분실물/습득물/전체) select가 있어서, 물건을
// 잃어버려 들어온 사람이 검색어를 적기도 전에 두 번의 선택을 먼저
// 해야 했다. 이제 홈 검색은 AI + 습득물로 고정되고(HomeSearchBar 자체
// 주석 참고) 사용자는 바로 입력만 하면 된다.
//
// 그 외 홈의 구조는 예전 그대로다 -- 검색 -> "어떤 물건을 찾고
// 있나요?" 카테고리 탐색 -> 최근 분실물 -> 최근 습득물. 카테고리
// 9칸도 그대로 있고, 달라진 건 각 칸의 이모지가 icons.tsx의 선형
// 아이콘으로 바뀐 것뿐이다(CategoryShortcuts 참고). 두 모드 선택과
// 게시판 선택은 /search·/lost·/found의 SearchFilterBar에 그대로 남아
// 있으므로, 검색 기능 자체는 어디서도 줄어들지 않았다.
//
// 검색 로직/AI API/이미지 검색/검색 결과 페이지는 전혀 건드리지 않았다
// -- 이번 변경은 홈이 그것들을 *어떻게 불러 쓰는지*만 바꾼다.
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
    <div className="flex flex-col gap-12">
      {/* 검색 -- 이 페이지에서 가장 중요한 동작이므로 맨 위에서 가장 큰
          타이포그래피를 가져간다. 예전 히어로와 같은 자리, 같은 여백이고
          (py-4/md:py-8, gap-5) 그 안에서 토글과 select 두 줄만 사라졌다.
          거대한 히어로로 키우거나 그라데이션/배지를 새로 넣지 않는다. */}
      <section className="flex flex-col items-center gap-5 py-4 text-center md:py-8">
        <h1 className="text-2xl leading-snug font-bold text-balance text-foreground md:text-3xl">
          {t("home.searchHeading")}
        </h1>
        {/* 보조 설명을 따로 두지 않는다 -- AISearchPanel이 입력창 바로
            아래에 이미 "물건의 특징을 설명해주세요. 사진을 더하면 더
            정확하게 찾을 수 있어요."를 렌더링하므로, 여기서 한 줄 더
            얹으면 같은 말이 두 번 나온다. */}
        <div className="w-full max-w-xl text-left">
          <HomeSearchBar />
        </div>
        {/* 가독성 개선 Phase: 두 버튼은 공유 Button의 secondary variant를
            그대로 쓴다(모양·크기·기존 동작 유지). 다만 그 variant의
            배경이 bg-card인데 라이트 모드에서 --card가 --background와
            똑같은 #ffffff라, 흰 페이지 위에서 "눌리는 것"처럼 보이지
            않았다 -- 그래서 이 두 곳에만 bg-muted/60을 덧씌워 면 대비를
            준다. secondary variant 자체는 건드리지 않는다: 앱 전체 19개
            파일 25곳이 쓰고 있어서, 여기 한 화면 때문에 관리자/단체/폼
            화면 버튼까지 같이 바뀌면 이번 작업 범위를 벗어난다. */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <LinkButton href="/lost" variant="secondary" size="sm" className="gap-1.5 bg-muted/60 hover:bg-muted">
            <BoxIcon className="size-4" /> {t("home.viewLost")}
          </LinkButton>
          <LinkButton href="/found" variant="secondary" size="sm" className="gap-1.5 bg-muted/60 hover:bg-muted">
            <HandboxIcon className="size-4" /> {t("home.viewFound")}
          </LinkButton>
        </div>
      </section>

      {/* Phase K: each section below the hero fades up the first time it's
          scrolled to (ScrollReveal -- no-op for content already on screen
          and for prefers-reduced-motion). Contents are unchanged. */}
      <ScrollReveal className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-foreground">{t("home.categories.title")}</h2>
        <CategoryShortcuts />
      </ScrollReveal>

      <ScrollReveal className="flex flex-col gap-4">
        <SectionHeader title={t("home.recentLost")} href="/lost" />
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
        <SectionHeader title={t("home.recentFound")} href="/found" />
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
  );
}
