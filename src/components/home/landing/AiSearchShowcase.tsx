import { BoxIcon, SearchIcon } from "@/components/icons";

// Phase 30: a purely static mockup -- no fetch, no real search/matching
// logic. The example query and the two result rows below it are fixed
// strings whose only job is to make "AI understands a sentence, not just
// keywords" click at a glance. Real search/AI matching is untouched
// elsewhere in the app; nothing here calls it.
const MOCK_RESULTS = [
  { title: "검은색 무선 이어폰 주웠어요", location: "중앙도서관 2층", score: 92 },
  { title: "블루투스 이어폰 한쪽 습득", location: "학생회관 1층", score: 78 },
];

export function AiSearchShowcase() {
  return (
    <section className="rounded-card border border-border bg-primary-muted/40 px-6 py-10 md:px-12 md:py-14">
      <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-2 md:gap-16">
        <div className="flex flex-col gap-3 text-center md:text-left">
          <span className="text-xs font-medium text-primary">AI 검색</span>
          <h2 className="text-xl font-bold text-foreground md:text-2xl">말하듯 검색하면, AI가 알아듣습니다</h2>
          <p className="text-sm text-muted-foreground md:text-base">
            핵심 단어만 적지 않아도 괜찮습니다. 상황을 그대로 문장으로 적으면 AI가 의미를 이해해서 비슷한 게시물을
            찾아드립니다.
          </p>
        </div>

        <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-sm md:p-5">
          <div className="flex items-center gap-2 rounded-full border border-border bg-background px-4 py-3">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <p className="truncate text-sm text-foreground">도서관에서 검은색 무선 이어폰을 잃어버렸어요.</p>
          </div>

          <div className="flex flex-col gap-2">
            <p className="px-1 text-xs font-medium text-muted-foreground">AI 검색 결과</p>
            {MOCK_RESULTS.map((result) => (
              <div key={result.title} className="flex items-center gap-3 rounded-card border border-border px-3 py-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <BoxIcon className="size-4" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="truncate text-sm font-medium text-foreground">{result.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{result.location}</p>
                </div>
                <span className="shrink-0 rounded-full bg-primary-muted px-2.5 py-1 text-xs font-medium text-primary">
                  AI 매칭 {result.score}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
