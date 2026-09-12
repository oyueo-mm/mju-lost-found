"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SearchIcon } from "@/components/icons";
import { AISearchPanel } from "@/components/search/AISearchPanel";
import { SearchModeToggle, type SearchUiMode } from "@/components/search/SearchModeToggle";
import { TYPE_OPTIONS } from "@/components/search/SearchFilterBar";
import type { PostListType } from "@/lib/posts/schema";
import { useI18n } from "@/lib/i18n/client";

// AI 검색 UI 시안 개선 Phase: Home의 히어로 검색창을 이 서비스의 기본
// 검색 경험(AI 검색)으로 바꾼다 -- 새 검색 API/알고리즘은 전혀 만들지
// 않고, /search·/lost·/found가 이미 쓰는 AISearchPanel을 그대로
// 재사용한다. 키워드 모드는 예전 HomeSearchBar와 똑같이 그냥
// /search?q=…로 이동한다(검색 로직 변경 없음).
//
// 검색 대상 및 게시글 목록 UX 개선 Phase §1/§3: 기본 검색 대상은
// 습득물이다 -- 잃어버린 물건을 찾으려고 검색하는 서비스이므로, 실제로
// 찾는 물건이 등록돼 있을 게시판(습득물)을 기본값으로 삼는다. AI 검색/
// 키워드 검색 모두 같은 기본값을 쓰고, SearchFilterBar와 똑같은
// TYPE_OPTIONS(습득물/분실물/전체) select로 언제든 바꿀 수 있다 -- 새
// 필터 UI를 따로 만들지 않고 이미 있는 구조를 그대로 재사용했다.
//
// `compact`(StickyHomeSearch가 스크롤 후 헤더 아래 띄우는 축소 버전)는
// 이번 Phase의 범위 밖이다 -- 아주 좁은 고정 바 안에 토글+대상 선택+사진
// 첨부까지 넣으면 오히려 "지금 이게 뭘 하는 기능인지" 알아보기 어려워질
// 위험이 커서, 이전 Phase에 이어 이번에도 히어로 검색창에만 새 UX를
// 적용했다. compact 인스턴스는 기존 키워드 전용 동작(대상=전체, 항상
// /search로 이동)을 그대로 유지한다.
export function HomeSearchBar({ compact = false }: { compact?: boolean } = {}) {
  const router = useRouter();
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<SearchUiMode>("ai");
  const [type, setType] = useState<PostListType>("found");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = value.trim();
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    params.set("type", type);
    router.push(`/search?${params.toString()}`);
  }

  if (compact) {
    return (
      <form onSubmit={handleSubmit} className="w-full">
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 shadow-sm transition-colors focus-within:border-primary">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t("home.searchPlaceholder")}
            maxLength={100}
            aria-label={t("home.searchAriaLabel")}
            className="w-full min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            type="submit"
            className="shrink-0 rounded-full bg-primary px-3.5 py-1 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {t("common.search")}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <SearchModeToggle mode={mode} onChange={setMode} />
        {/* 검색 대상 및 게시글 목록 UX 개선 Phase §3: "검색 대상 자체가
            UI에서 명확하게 보이는 것"을 우선한다는 요구사항 -- 별도
            설명 문구 대신, 실제로 검색될 게시판 이름이 선택된 값으로
            그대로 보이는 select 하나를 토글 옆에 둔다. */}
        <select
          value={type}
          onChange={(e) => setType(e.target.value as PostListType)}
          aria-label={t("home.searchTargetLabel")}
          className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground shadow-sm"
        >
          {TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t("home.searchIn", { board: t(option.labelKey) })}
            </option>
          ))}
        </select>
      </div>

      {mode === "ai" ? (
        // 결과 카드(PostCard)는 자기 텍스트 정렬을 직접 지정하지 않으므로,
        // 히어로 섹션 전체에 걸린 text-center가 상속되지 않도록 이 블록만
        // 다시 text-left로 되돌린다.
        <div className="w-full text-left">
          <AISearchPanel type={type} placeholder={t("home.aiPlaceholder")} />
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="w-full">
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-3 shadow-sm transition-colors focus-within:border-primary">
            <SearchIcon className="size-5 shrink-0 text-muted-foreground" />
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t("home.searchPlaceholder")}
              maxLength={100}
              aria-label={t("home.searchAriaLabel")}
              className="w-full min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <button
              type="submit"
              className="shrink-0 rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              {t("common.search")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
