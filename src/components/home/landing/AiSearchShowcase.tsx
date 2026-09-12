import { BoxIcon, SearchIcon } from "@/components/icons";
import { getTranslator } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/translate";

// Phase 30: a purely static mockup -- no fetch, no real search/matching
// logic. The example query and the two result rows below it are fixed
// strings whose only job is to make "AI understands a sentence, not just
// keywords" click at a glance. Real search/AI matching is untouched
// elsewhere in the app; nothing here calls it.
// 다국어(i18n) Phase: 이 두 줄은 실제 게시글이 아니라 화면을 설명하기
// 위한 고정 예시 문구다(위 주석 참고) -- 그래서 DB 값과 달리 번역해도
// 안전하고, 번역해야 유학생에게도 "이런 식으로 검색하면 이런 게 나온다"가
// 전달된다.
const MOCK_RESULTS: { titleKey: TranslationKey; locationKey: TranslationKey; score: number }[] = [
  {
    titleKey: "landing.aiShowcase.sample1.title",
    locationKey: "landing.aiShowcase.sample1.location",
    score: 92,
  },
  {
    titleKey: "landing.aiShowcase.sample2.title",
    locationKey: "landing.aiShowcase.sample2.location",
    score: 78,
  },
];

export async function AiSearchShowcase() {
  const t = await getTranslator();

  return (
    <section className="rounded-card border border-border bg-primary-muted/40 px-6 py-10 md:px-12 md:py-14">
      <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-2 md:gap-16">
        <div className="flex flex-col gap-3 text-center md:text-left">
          <span className="text-xs font-medium text-primary">{t("landing.aiShowcase.badge")}</span>
          <h2 className="text-xl font-bold text-foreground md:text-2xl">{t("landing.aiShowcase.title")}</h2>
          <p className="text-sm text-muted-foreground md:text-base">
            {t("landing.aiShowcase.description")}
          </p>
        </div>

        <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-sm md:p-5">
          <div className="flex items-center gap-2 rounded-full border border-border bg-background px-4 py-3">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <p className="truncate text-sm text-foreground">{t("landing.aiShowcase.exampleQuery")}</p>
          </div>

          <div className="flex flex-col gap-2">
            <p className="px-1 text-xs font-medium text-muted-foreground">{t("landing.aiShowcase.resultsLabel")}</p>
            {MOCK_RESULTS.map((result) => (
              <div key={result.titleKey} className="flex items-center gap-3 rounded-card border border-border px-3 py-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <BoxIcon className="size-4" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="truncate text-sm font-medium text-foreground">{t(result.titleKey)}</p>
                  <p className="truncate text-xs text-muted-foreground">{t(result.locationKey)}</p>
                </div>
                <span className="shrink-0 rounded-full bg-primary-muted px-2.5 py-1 text-xs font-medium text-primary">
                  {t("landing.aiShowcase.matchScore", { score: result.score })}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
