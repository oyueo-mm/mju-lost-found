import Link from "next/link";

import { CATEGORY_CODES, type CategoryCode } from "@/lib/posts/categoryTaxonomy";
import { getTranslator } from "@/lib/i18n/server";
import { taxonomyCategoryLabelKey } from "@/lib/i18n/labels";
import { CATEGORY_ICONS } from "@/components/post/categoryIcons";
import { GridIcon } from "@/components/icons";

// Phase 17: real CATEGORIES (posts/schema.ts) only -- never a hardcoded
// list that could drift from what search/filter forms actually accept.
//
// 카테고리 아이콘 UI 개선 Phase: 예전에는 카테고리마다 이모지를 붙였다
// (🎧✏️📚👛💳👕🎒💍📦). 이모지는 글꼴·OS·플랫폼마다 모양과 색이 제각각이라
// 9칸이 나란히 놓이면 크기도 채도도 들쭉날쭉해 보였고, 앱의 나머지 UI가
// 쓰는 단색 선형 아이콘 언어와도 겉돌았다. 이제는 icons.tsx에 같은 규격
// (24x24, 1.75px stroke, currentColor)으로 직접 그린 9개 글리프를 쓴다
// -- 새 아이콘 라이브러리나 의존성은 추가하지 않았고, 색도 아이콘이
// 스스로 정하지 않고 부모의 text 색을 물려받으므로 라이트/다크 모드가
// 자동으로 맞는다.
// 카테고리 대분류-소분류: 바로가기는 새 대분류 code 9개를 쓴다(기존 9개
// 한국어 값과 1:1 -- 생활용품만 예전 "기타" 자리).
// CATEGORY_ICONS now lives in components/post/categoryIcons.ts (shared
// with the post card's no-photo tile).

// 홈 카테고리 버튼 동작 수정 Phase: 이 바로가기는 "AI 검색을 실행하는
// 버튼"이 아니라 "이 카테고리 게시글을 보여달라"는 필터 버튼이다.
// 예전에는 `/search?category=...`로만 보냈는데, /search의 검색 모드
// 토글(SearchFilterBar)은 URL에 `mode`가 전혀 없으면 그 페이지의
// defaultMode인 "ai"로 시작한다 -- AI 모드에서는 서버가 이미 렌더링해
// children으로 내려준 키워드 검색 결과를 통째로 숨기므로
// (`{mode !== "ai" && children}`), 카테고리를 눌러도 해당 카테고리
// 게시글 대신 텅 빈 AI 검색창만 보이는 것이 이 버그의 실제 원인이었다.
//
// 그래서 URL에 키워드 모드를 명시한다 -- 검색 모드 URL 상태 Phase부터는
// 화면 모드 파라미터가 `searchMode=keyword`다(API의 `mode`와 분리, 자세한
// 이유는 components/search/searchModeParams.ts). SearchFilterBar는 URL의
// 명시적 mode를 defaultMode보다 항상 우선하므로 키워드 모드로 열리고,
// 서버(search/page.tsx)의 listQuerySchema도 "keyword"를 그대로 받아
// (SEARCH_MODES의 기본값이자 유효값) 기존 키워드 검색 경로를 탄다 --
// AI 검색/임베딩 로직은 전혀 건드리지 않았다. `q`는 일부러 넣지
// 않는다: 카테고리 필터만 걸린 목록이 이 버튼이 약속하는 결과이고,
// 검색어를 임의로 지어내면 오히려 결과가 줄어든다.
//
// `type=found`는 /search가 이미 쓰고 있는 기본 검색 대상과 같은 값이다
// (search/page.tsx, SearchFilterBar 둘 다 "found"가 기본) -- 잃어버린
// 물건을 찾으려고 누르는 버튼이므로 습득물 게시판이 기본이라는 기존
// 방향 그대로이고, 명시해 두면 SearchFilterBar의 게시판 select도
// URL과 항상 일치한다. /search에 직접 들어갔을 때의 AI 검색 기본값은
// 이 변경과 무관하게 그대로다(URL에 mode가 아예 없는 경우이므로).
const CATEGORY_SEARCH_PARAMS = { searchMode: "keyword", type: "found" } as const;

// 별도 함수로 빼 둔 이유: 이 링크가 만들어내는 쿼리가 곧 이 컴포넌트의
// 계약이라, JSX를 렌더링하지 않고도 단위 테스트로 고정해 둘 수 있게
// 한다(CategoryShortcuts.test.ts -- mode/type/category/q 네 가지를 전부
// 검증하고, 실제 listQuerySchema로 파싱까지 해 본다).
// 카테고리 대분류-소분류: 필터는 legacy `category`가 아니라 `categoryCode`로
// 건다(SearchFilterBar의 대분류 select가 읽는 값과 같다).
export const PHONE_SHORTCUTS = 7;

export function categorySearchHref(categoryCode: CategoryCode): string {
  return `/search?${new URLSearchParams({ ...CATEGORY_SEARCH_PARAMS, categoryCode }).toString()}`;
}

export async function CategoryShortcuts() {
  const t = await getTranslator();

  return (
    // Soft Card: small chips, not tiles. One horizontally scrollable row on
    // phones (the whole fixed order, then 전체 보기) and a wrapped row from
    // md, so the categories stay one tap away without taking two screens.
    <div className="scroll-rail -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
      {CATEGORY_CODES.map((categoryCode) => {
        // URL에는 언어와 무관한 code가 들어가고, 버튼 글자만 현재 언어로 바뀐다.
        const Icon = CATEGORY_ICONS[categoryCode] ?? GridIcon;
        return (
          <Link
            key={categoryCode}
            href={categorySearchHref(categoryCode)}
            className="group flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-sm font-medium break-keep whitespace-nowrap text-foreground transition-colors hover:border-primary/40 hover:bg-primary-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Icon aria-hidden="true" className="size-4 text-muted-foreground transition-colors group-hover:text-primary" />
            {t(taxonomyCategoryLabelKey(categoryCode))}
          </Link>
        );
      })}
      <Link
        href={`/search?${new URLSearchParams(CATEGORY_SEARCH_PARAMS).toString()}`}
        className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-border px-3.5 text-sm font-medium whitespace-nowrap text-muted-foreground hover:border-primary/40 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <GridIcon aria-hidden="true" className="size-4" />
        {t("home.categories.all")}
      </Link>
    </div>
  );
}
