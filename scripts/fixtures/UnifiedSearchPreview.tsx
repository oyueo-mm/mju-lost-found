import { createRoot } from "react-dom/client";
import { usePathname, useSearchParams } from "./searchPreviewNavigation";
import { SearchFilterBar } from "../../src/components/search/SearchFilterBar";
import { SemanticSearchResults } from "../../src/components/search/SemanticSearchResults";
import { HomeSearchBar } from "../../src/components/home/HomeSearchBar";
import { I18nProvider } from "../../src/lib/i18n/client";
import { ko } from "../../src/lib/i18n/messages/ko";
import { FOUND_STATUSES, LOST_STATUSES } from "../../src/lib/posts/schema";
import { DesktopNav } from "../../src/components/layout/DesktopNav";
import { MobileSearchLink } from "../../src/components/layout/MobileSearchLink";

function Preview() {
  const path = usePathname();
  const search = useSearchParams();
  const board = path === "/lost" ? "lost" : path === "/found" ? "found" : undefined;
  const type = board ?? search.get("type") ?? "found";
  const statuses = board === "lost" ? LOST_STATUSES : FOUND_STATUSES;
  const raw = Object.fromEntries(search);
  const params: Record<string, string> = { ...raw, type, mode: raw.mode === "keyword" || raw.mode === "semantic" ? raw.mode : "unified" };
  if (board && !search.has("status")) params.status = statuses[0];
  if (params.status === "") delete params.status;
  return <I18nProvider locale="ko" messages={ko}>
    <main className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6 px-4 py-8" data-wide-board>
      <div data-preview-header className="flex items-center justify-between gap-2">
        <DesktopNav unreadChatCount={0} onSignOut={() => {}} />
        <MobileSearchLink />
      </div>
      <header className="flex flex-col gap-2"><h1 className="text-xl font-semibold">MJU Find · 통합 검색</h1><p className="text-xs text-muted-foreground">로컬 평가 게시글 249개 · 저장 임베딩 재사용 · DB 연결·데이터 변경 없음</p>
        <nav className="flex flex-wrap gap-4 text-sm text-primary"><a href="/home">홈 검색</a><a href="/search">통합 검색</a><a href="/lost">분실물</a><a href="/found">습득물</a></nav>
      </header>
      {path === "/home" ? <HomeSearchBar /> : <SearchFilterBar basePath={board ? `/${board}` : "/search"} showTypeFilter={!board} fixedType={board} imageSearchEnabled defaultStatus={board ? statuses[0] : undefined} statusOptions={board ? statuses.map((value) => ({ value, label: value })) : undefined}>
        <SemanticSearchResults params={params} basePath={board ? `/${board}` : "/search"} board={Boolean(board)} />
      </SearchFilterBar>}
    </main>
  </I18nProvider>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
