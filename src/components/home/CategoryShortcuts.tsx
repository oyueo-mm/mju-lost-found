import Link from "next/link";
import type { ComponentType, SVGProps } from "react";

import { CATEGORIES } from "@/lib/posts/schema";
import { getTranslator } from "@/lib/i18n/server";
import { categoryLabelKey } from "@/lib/i18n/labels";
import {
  BagIcon,
  BookIcon,
  CardIcon,
  GridIcon,
  HeadphonesIcon,
  PenIcon,
  RingIcon,
  ShirtIcon,
  WalletIcon,
} from "@/components/icons";

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
const CATEGORY_ICONS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  전자기기: HeadphonesIcon,
  필기구: PenIcon,
  책: BookIcon,
  지갑: WalletIcon,
  카드: CardIcon,
  의류: ShirtIcon,
  가방: BagIcon,
  액세서리: RingIcon,
  기타: GridIcon,
};

// 홈 카테고리 버튼 동작 수정 Phase: 이 바로가기는 "AI 검색을 실행하는
// 버튼"이 아니라 "이 카테고리 게시글을 보여달라"는 필터 버튼이다.
// 예전에는 `/search?category=...`로만 보냈는데, /search의 검색 모드
// 토글(SearchFilterBar)은 URL에 `mode`가 전혀 없으면 그 페이지의
// defaultMode인 "ai"로 시작한다 -- AI 모드에서는 서버가 이미 렌더링해
// children으로 내려준 키워드 검색 결과를 통째로 숨기므로
// (`{mode !== "ai" && children}`), 카테고리를 눌러도 해당 카테고리
// 게시글 대신 텅 빈 AI 검색창만 보이는 것이 이 버그의 실제 원인이었다.
//
// 그래서 URL에 `mode=keyword`를 명시한다 -- SearchFilterBar는 URL의
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
const CATEGORY_SEARCH_PARAMS = { mode: "keyword", type: "found" } as const;

// 별도 함수로 빼 둔 이유: 이 링크가 만들어내는 쿼리가 곧 이 컴포넌트의
// 계약이라, JSX를 렌더링하지 않고도 단위 테스트로 고정해 둘 수 있게
// 한다(CategoryShortcuts.test.ts -- mode/type/category/q 네 가지를 전부
// 검증하고, 실제 listQuerySchema로 파싱까지 해 본다).
export function categorySearchHref(category: string): string {
  return `/search?${new URLSearchParams({ ...CATEGORY_SEARCH_PARAMS, category }).toString()}`;
}

export async function CategoryShortcuts() {
  const t = await getTranslator();

  return (
    // 카테고리 아이콘 UI 개선 Phase: 칸 자체는 예전과 같은 9칸 grid
    // (모바일 3열 / sm 5열 / md 9열)로 정보 구조와 사용성을 그대로
    // 유지한다. 달라진 건 칸 "안"이다:
    // - rounded-card(0.875rem)에서 rounded-lg로 낮췄다 -- 한 줄에 9개가
    //   붙어 서는 작은 칸에서 큰 라운드는 알약처럼 보여 "탐색 목록"
    //   보다 "장식 버튼"처럼 읽힌다.
    // - 가독성 개선 Phase("너무 하얘 / 테두리 / 직관적으로"): 배경을
    //   bg-card에서 bg-muted/60으로 바꿨다. 라이트 모드에서 --card와
    //   --background가 똑같이 #ffffff라, 흰 페이지 위에 흰 카드가 얹혀
    //   #e4e4e7 테두리 한 줄만으로 영역을 구분해야 했던 것이 "너무 하얘
    //   보이고 테두리가 없어 보이는" 실제 원인이었다. --muted(#f4f5f7)를
    //   옅게 깔면 페이지와 칸이 면(surface)으로 구분되고, 그제야 같은
    //   테두리도 눈에 들어온다. 새 색을 만들지 않고 기존 --muted를
    //   쓴 것이라 다크 모드(#1c1f27 위 #0b0d12 배경)에서도 그대로
    //   성립한다.
    // - hover는 테두리와 배경을 함께 primary 쪽으로 올린다
    //   (border-primary/40 + bg-primary-muted). "누를 수 있는 칸"이라는
    //   신호를 색 하나가 아니라 면+선+아이콘 세 가지가 같이 낸다.
    //   shadow/gradient는 쓰지 않는다.
    // - 아이콘 9개는 전부 하나의 primary 색 체계를 공유한다. 카테고리마다
    //   다른 색(빨강/노랑/초록 등)을 주지 않는 이유는 9칸이 한 줄에 나란히
    //   서는 자리라 색이 갈리는 순간 통일감과 대칭성이 먼저 깨지기
    //   때문이다 -- 색은 여기서 "분류"를 뜻하지 않는다(분류는 이미
    //   아이콘 모양과 이름이 말하고 있다).
    //   평상시 text-primary/70, hover에서 text-primary. 새 색이나 새
    //   디자인 토큰을 만들지 않고 기존 --primary 하나에 불투명도만
    //   달리한 것이라, 라이트/다크 각각의 --primary 값을 그대로 따라간다
    //   (이 저장소가 이미 text-muted-foreground/70, border-primary/30
    //   등으로 쓰고 있는 방식과 같다).
    //   --primary-muted를 쓰지 않은 이유: 그 토큰은 배경 틴트용(라이트
    //   #eaf1ff)이라 카드 배경 위 선(stroke) 색으로 쓰면 거의 보이지
    //   않는다.
    // - 카테고리명은 text-foreground 그대로 둔다 -- 아이콘(primary/70)
    //   보다 대비가 높아 여전히 이름이 먼저 읽힌다.
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-9">
      {CATEGORIES.map((category) => {
        // 다국어(i18n) Phase: URL의 `category` 값은 언제나 DB/스키마가
        // 아는 한국어 원문 그대로다(번역된 값을 보내면 검색이 0건이 된다)
        // -- 버튼에 보이는 글자만 현재 언어로 바뀐다.
        const labelKey = categoryLabelKey(category);
        const Icon = CATEGORY_ICONS[category] ?? GridIcon;
        return (
          <Link
            key={category}
            href={categorySearchHref(category)}
            className="group flex flex-col items-center gap-2 rounded-lg border border-border bg-muted/60 px-2 py-3 text-center transition-colors hover:border-primary/40 hover:bg-primary-muted"
          >
            <Icon className="size-5 text-primary/70 transition-colors group-hover:text-primary" />
            <span className="text-xs font-medium text-foreground">{labelKey ? t(labelKey) : category}</span>
          </Link>
        );
      })}
    </div>
  );
}
