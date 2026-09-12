import Link from "next/link";

import { CATEGORIES } from "@/lib/posts/schema";
import { getTranslator } from "@/lib/i18n/server";
import { categoryLabelKey } from "@/lib/i18n/labels";

// Phase 17: real CATEGORIES (posts/schema.ts) only -- never a hardcoded
// list that could drift from what search/filter forms actually accept.
// Emoji here (not this app's custom icon set in icons.tsx) is a
// deliberate exception: distinguishing 9 different physical-object
// categories at a glance needs real per-category glyphs, and hand-drawing
// 9 more bespoke SVGs for a single homepage section isn't worth it next
// to Unicode's existing, universally-rendered set -- icons.tsx stays
// reserved for the small, reused set of *UI-chrome* icons (nav, status,
// metadata) where a consistent stroke language actually matters.
const CATEGORY_EMOJI: Record<string, string> = {
  전자기기: "🎧",
  필기구: "✏️",
  책: "📚",
  지갑: "👛",
  카드: "💳",
  의류: "👕",
  가방: "🎒",
  액세서리: "💍",
  기타: "📦",
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

export function categorySearchHref(category: string): string {
  return `/search?${new URLSearchParams({ ...CATEGORY_SEARCH_PARAMS, category }).toString()}`;
}

export async function CategoryShortcuts() {
  const t = await getTranslator();

  return (
    <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5 md:grid-cols-9">
      {CATEGORIES.map((category) => {
        // 다국어(i18n) Phase: URL의 `category` 값은 언제나 DB/스키마가
        // 아는 한국어 원문 그대로다(번역된 값을 보내면 검색이 0건이 된다)
        // -- 버튼에 보이는 글자만 현재 언어로 바뀐다.
        const labelKey = categoryLabelKey(category);
        return (
          <Link
            key={category}
            href={categorySearchHref(category)}
            className="flex flex-col items-center gap-1.5 rounded-card border border-border bg-card px-2 py-3.5 text-center transition-colors hover:border-foreground/30"
          >
            <span className="text-2xl" aria-hidden>
              {CATEGORY_EMOJI[category] ?? "📦"}
            </span>
            <span className="text-xs font-medium text-foreground">{labelKey ? t(labelKey) : category}</span>
          </Link>
        );
      })}
    </div>
  );
}
