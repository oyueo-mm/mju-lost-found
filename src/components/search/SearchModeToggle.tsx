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

export function SearchModeToggle({ mode, onChange }: SearchModeToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="검색 방식"
      className="flex w-fit gap-0.5 rounded-full bg-muted p-0.5"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={mode === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            mode === option.value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
