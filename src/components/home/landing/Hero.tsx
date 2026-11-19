import { HomeSearchBar } from "@/components/home/HomeSearchBar";
import { getTranslator } from "@/lib/i18n/server";
import { HomeSearchProvider, HomeSearchResults } from "../HomeSearch";

// The home's first screen, signed in or out (app/(main)/page.tsx): the service
// name as the headline, one line on what the service does, and the search itself -- the
// natural-language / photo search (HomeSearchBar, "landing" variant: no
// repeated hint). Soft Card: a very light grey rounded card on the white
// page, no gradient or glow. The browse / post shortcuts follow in
// QuickActions, the categories and the newest posts after that, so the first
// phone screen is the search plus the next action, not a wall of headline.
export async function Hero() {
  const t = await getTranslator();
  const [line1, line2 = ""] = t("landing.searchHeadline").split("\n", 2);

  return (
    <HomeSearchProvider><section className="flex flex-col gap-2.5 rounded-3xl border border-border bg-muted/60 px-4 pt-5 pb-4 md:gap-4 md:px-10 md:py-10" data-home-hero>
      {/* 서비스 명칭 자체가 제목: 모바일은 두 줄(대학명 / 분실물 센터), md 이상은
          한 줄. 두 줄 사이는 공백 하나라 한 줄일 때도 자연스럽게 읽힌다. */}
      <h1 className="text-[1.75rem] leading-[1.25] font-extrabold tracking-[-0.03em] break-keep text-foreground sm:text-4xl md:text-5xl md:leading-[1.2]">
        <span className="block md:inline">{line1}</span>
        {line2 && (
          <>
            {" "}
            <span className="block md:inline">{line2}</span>
          </>
        )}
      </h1>

      <p className="max-w-xl text-sm leading-relaxed break-keep whitespace-pre-line text-muted-foreground md:text-base">
        {t("landing.subtitle")}
      </p>

      {/* The search itself. The id is what LandingStickyCta watches: once
          this has scrolled away, its floating "find" button takes over. */}
      <div id="landing-hero-cta" className="mt-1 w-full max-w-2xl">
        <HomeSearchBar variant="landing" />
      </div>
      <HomeSearchResults />
    </section></HomeSearchProvider>
  );
}
