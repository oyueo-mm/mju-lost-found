// AI 검색 UI 시안 개선 Phase: 검색 방식(AI 검색 / 키워드 검색)을 고르는
// compact segmented control -- SearchFilterBar(/search, /lost, /found)와
// Home의 검색창이 똑같은 컴포넌트를 똑같은 자리(입력창 바로 위, 같은
// 카드에 묶여서)에 두어 "화면마다 다른 제품처럼 보이지 않게" 한다(이번
// Phase 요구사항 §5). AI 검색이 항상 먼저(왼쪽) 나온다 -- 이 컴포넌트가
// 소유하는 건 라벨/모양/순서뿐이고, 어느 쪽이 *기본 선택*인지는 호출자가
// 결정한다(검색 기본 모드 UX 수정 Phase: Home/`/search`는 AI 검색, `/lost`
// `/found`는 키워드 검색이 기본 -- SearchFilterBar의 `defaultMode` prop
// 참고).
export type SearchUiMode = "ai" | "keyword";

type SearchModeToggleProps = {
  mode: SearchUiMode;
  onChange: (mode: SearchUiMode) => void;
};

const OPTIONS: { value: SearchUiMode; label: string }[] = [
  { value: "ai", label: "AI 검색" },
  { value: "keyword", label: "키워드 검색" },
];

// 다크모드 토글 UI Phase: 이전에는 선택된 pill이 `bg-card`(트랙의
// `bg-muted` 위에 얹힌 "떠 있는 카드"처럼 보이도록)였다 -- 라이트 모드에서
//는 --card가 --muted보다 밝아서 잘 보였지만, 다크 모드에서는 --card
// (#14161c)가 --muted(#1c1f27)보다 오히려 더 어두워서 선택된 pill이
// 오히려 배경 속으로 꺼져 보이는 문제가 있었다(게다가 `shadow-sm`도
// 어두운 배경 위에서는 사실상 보이지 않는다). 이 앱이 이미 어디서나
// "선택된 상태"에 쓰는, 밝기가 아니라 색상(primary) 대비로 구분되는
// 검증된 조합(ThemeSettings의 다크/라이트 토글 등 19곳에서 재사용 중)으로
// 맞췄다 -- 새 토큰이나 새 컴포넌트를 만들지 않았다.
export function SearchModeToggle({ mode, onChange }: SearchModeToggleProps) {
  return (
    <div className="flex w-fit flex-wrap gap-1.5" role="radiogroup" aria-label="검색 방식">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={mode === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            mode === option.value
              ? "border-primary bg-primary-muted text-primary"
              : "border-border text-muted-foreground hover:border-foreground/30"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
