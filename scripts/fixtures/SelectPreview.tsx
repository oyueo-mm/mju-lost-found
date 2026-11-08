import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Select } from "../../src/components/ui/Select";
import { CategoryPicker } from "../../src/components/post/CategoryPicker";
import { SearchFilterBar } from "../../src/components/search/SearchFilterBar";
import { HourlyMetricSelect } from "../../src/components/admin/HourlyMetricSelect";
import { AdminRoleFilters } from "../../src/components/admin/AdminRoleFilters";
import { I18nProvider } from "../../src/lib/i18n/client";
import { ko } from "../../src/lib/i18n/messages/ko";
import { en } from "../../src/lib/i18n/messages/en";
import type { CategoryFormValue } from "../../src/components/post/categoryFormState";
import { useSearchParams } from "./selectNavigation";

function Preview() {
  const [locale, setLocale] = useState<"ko" | "en">("ko");
  const [category, setCategory] = useState<CategoryFormValue>({ categoryCode: null, subcategory: null });
  const [submitted, setSubmitted] = useState("");
  const params = useSearchParams();
  const selectRef = useRef<HTMLSelectElement>(null);
  return (
    <I18nProvider locale={locale} messages={locale === "ko" ? ko : en}>
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div><h1 className="text-xl font-semibold">MJU Find · 선택 UI</h1><p className="mt-1 text-sm text-muted-foreground">로컬 샘플 데이터 · DB/API 연결 없음</p></div>
          <label className="flex items-center gap-2 text-sm">언어<Select id="locale" value={locale} onChange={(e) => setLocale(e.target.value as "ko" | "en")}><option value="ko">한국어</option><option value="en">English</option></Select></label>
        </header>

        <section id="filters" className="flex min-w-0 flex-col gap-3">
          <h2 className="font-semibold">게시판 필터·정렬</h2>
          <SearchFilterBar basePath="/found" fixedType="found" defaultMode="keyword" resultCount={12} defaultStatus="보관 중" statusOptions={[{ value: "보관 중", label: "보관 중" }, { value: "완료", label: "완료" }]}>
            <p className="text-sm text-muted-foreground">필터·정렬 변경 시 아래 URL이 갱신됩니다. 검색 결과 조회는 수행하지 않습니다.</p>
          </SearchFilterBar>
          <output id="query-output" className="break-all rounded-lg bg-muted p-3 text-xs">{params.toString()}</output>
        </section>

        <form id="post-form" className="flex min-w-0 flex-col gap-4 rounded-card border border-border p-4" onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)), null, 2));
        }} onReset={() => { setTimeout(() => { setCategory({ categoryCode: null, subcategory: null }); setSubmitted(""); }, 0); }}>
          <h2 className="font-semibold">게시글 폼 · 필수·종속 선택</h2>
          <CategoryPicker value={category} onChange={setCategory} required legacyUnmapped={null} title="" description="" />
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1.5 text-sm">캠퍼스<Select ref={selectRef} name="campus" defaultValue="인문캠퍼스" required><option value="인문캠퍼스">인문캠퍼스</option><option value="자연캠퍼스">자연캠퍼스</option></Select></label>
            <label className="flex min-w-0 flex-col gap-1.5 text-sm">사용 불가<Select id="disabled-select" name="disabledField" defaultValue="locked" disabled><option value="locked">권한 없음</option></Select></label>
          </div>
          <div className="flex flex-wrap gap-3 text-sm"><button className="rounded-lg bg-primary px-4 py-2 text-primary-foreground" type="submit">제출 확인</button><button className="rounded-lg border border-border px-4 py-2" type="reset">초기화</button><button type="button" className="rounded-lg border border-border px-4 py-2" onClick={() => selectRef.current?.focus()}>캠퍼스로 포커스</button></div>
          <output id="form-output" className="whitespace-pre-wrap break-all text-xs">{submitted}</output>
        </form>

        <section id="admin" className="flex min-w-0 flex-col gap-3" onSubmitCapture={(e) => {
          e.preventDefault();
          if (e.target instanceof HTMLFormElement) setSubmitted(JSON.stringify(Object.fromEntries(new FormData(e.target)), null, 2));
        }}>
          <h2 className="font-semibold">관리자·운영 통계</h2>
          <AdminRoleFilters filter={{ role: "service" }} from="2026-11-01" to="2026-11-08" institutions={[{ id: 11, name: "학생회관 관리 기관", managementCampus: "인문캠퍼스" }, { id: 12, name: "아주 긴 기관 이름을 가진 캠퍼스 공동 관리 기관", managementCampus: "자연캠퍼스" }]} accounts={[{ id: 150, nickname: "관리자" }, { id: 151, nickname: null }]} />
          <HourlyMetricSelect value={params.get("m") ?? "pv"} options={[{ value: "pv", label: "페이지뷰" }, { value: "sessions", label: "방문 세션" }, { value: "all", label: "전체 지표 보기" }]} />
        </section>

        <section id="states" className="grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1.5 text-sm">오류 상태<Select id="error-select" defaultValue="" error aria-describedby="select-error"><option value="">항목을 선택하세요</option><option value="valid">유효한 선택</option></Select><span id="select-error" className="text-xs text-destructive">선택값을 확인해 주세요.</span></label>
          <label className="flex min-w-0 flex-col gap-1.5 text-sm">옵션 그룹<Select id="groups" defaultValue="wallet"><option value="">전체</option><optgroup label="개인 소지품"><option value="wallet">지갑</option><option value="card">학생증·카드</option><option value="unavailable" disabled>사용할 수 없는 항목</option></optgroup><optgroup label="사용 불가 그룹" disabled><option value="blocked">선택할 수 없음</option></optgroup><optgroup label="전자기기"><option value="phone">휴대폰</option><option value="laptop">노트북</option></optgroup></Select></label>
          <label className="flex min-w-0 flex-col gap-1.5 text-sm">긴 항목명<Select id="long-option" defaultValue="long"><option value="long">아주 긴 기관 이름과 공백없는문자열테스트를위해충분히길게작성한항목입니다반복반복반복반복반복</option><option value="short">짧은 항목</option></Select></label>
          <label className="flex min-w-0 flex-col gap-1.5 text-sm">네이티브 유지<Select id="native-select" native defaultValue="a"><option value="a">운영체제 기본 옵션 팝업</option><option value="b">다른 항목</option></Select></label>
          <label className="flex min-w-0 flex-col gap-1.5 text-sm">다중 선택·목록 상자 유지<Select id="multiple-select" multiple size={3} defaultValue={["a", "c"]}><option value="a">A</option><option value="b">B</option><option value="c">C</option></Select></label>
        </section>

        <section id="edge" className="flex min-w-0 flex-col gap-2 pb-4">
          <label htmlFor="many-options" className="text-sm">많은 옵션 · 화면 아래에서 위로 열기</label>
          <Select id="many-options" defaultValue="0">{Array.from({ length: 100 }, (_, i) => <option key={i} value={i}>관리 기관 {i + 1}</option>)}</Select>
        </section>
      </main>
    </I18nProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
