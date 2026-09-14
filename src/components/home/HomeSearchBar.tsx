"use client";

import { AISearchPanel } from "@/components/search/AISearchPanel";
import { useI18n } from "@/lib/i18n/client";

export const HOME_POPULAR_SEARCHES = ["카드", "지갑", "무선 이어폰", "휴대폰"] as const;

// Home UX 단순화 Phase: 홈의 검색은 이제 고를 것이 없다 -- AI 검색으로,
// 습득물 게시판을 대상으로 고정된다. 사용자는 검색창에 찾는 물건을
// 문장으로 적기만 하면 된다.
//
// 왜 이 두 가지로 고정하나:
// - AI 고정: 홈에 처음 들어온 사람에게 "AI 검색이냐 키워드 검색이냐"는
//   답할 이유가 없는 질문이다. 자연어로 적어도 의미로 찾아주는 쪽이
//   기본값으로서 더 관대하고, 그게 이 서비스가 내세우는 검색 경험이다.
// - 습득물 고정: 물건을 잃어버려서 홈에 들어온 사람이 찾아야 할 것은
//   "누군가 주워서 올린 글"이다. 원래도 홈의 기본 검색 대상은
//   습득물("found")이었고, 이제 select 없이 그 값으로 굳어졌을 뿐이라
//   기본 동작은 달라지지 않았다.
//
// 이전 버전에 있던 것들과 그 행선지:
// - SearchModeToggle(AI/키워드), 검색 대상 select -> 제거. 둘 다
//   /search·/lost·/found의 SearchFilterBar에 그대로 살아 있다.
// - `compact` 모드(StickyHomeSearch가 스크롤 후 헤더 아래 띄우던 축소
//   검색 바) -> 제거. 홈이 "검색 + 습득물 한 섹션"으로 짧아져 위로
//   돌아가는 비용이 거의 없어졌고, 그 축소 바는 키워드 전용이라
//   "홈은 AI 검색" 원칙과도 어긋났다. 게다가 그 바는 제출 시
//   `/search?q=...`(mode 없음)로 이동했는데, mode가 없으면 /search의
//   SearchFilterBar가 AI 모드로 열리면서 입력한 검색어가 화면에
//   반영되지 않고 사라졌다 -- 이번에 그 경로 자체가 없어지며 함께
//   해소됐다.
//
// 사진 첨부(이미지 검색)는 공유 AISearchPanel이 이미 갖고 있는 카메라
// 버튼을 그대로 쓴다. 인기 검색어도 선택적 prop으로만 전달하므로 이
// 화면에서만 보이고 /search, /lost, /found의 패널은 바뀌지 않는다.
export function HomeSearchBar() {
  const { t } = useI18n();
  const quickSearchItems = [
    { query: HOME_POPULAR_SEARCHES[0], label: t("home.popular.card") },
    { query: HOME_POPULAR_SEARCHES[1], label: t("home.popular.wallet") },
    { query: HOME_POPULAR_SEARCHES[2], label: t("home.popular.wirelessEarbuds") },
    { query: HOME_POPULAR_SEARCHES[3], label: t("home.popular.phone") },
  ];

  return (
    <AISearchPanel
      type="found"
      placeholder={t("home.aiPlaceholder")}
      quickSearchLabel={t("home.popularSearches")}
      quickSearchItems={quickSearchItems}
      controlsClassName="mx-auto w-full max-w-xl text-center [&>div]:justify-center [&>p]:text-center"
    />
  );
}
