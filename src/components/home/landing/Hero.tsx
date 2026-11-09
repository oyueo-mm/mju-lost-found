import { HomeSearchBar } from "@/components/home/HomeSearchBar";
import { getTranslator } from "@/lib/i18n/server";
import { HomeSearchProvider, HomeSearchResults } from "../HomeSearch";

// The home's first screen, signed in or out (app/(main)/page.tsx): a short
// headline, one line on what the service does, and the search itself -- the
// natural-language / photo search (HomeSearchBar, "landing" variant: no
// repeated hint). Soft Card: a very light grey rounded card on the white
// page, no gradient or glow. The browse / post shortcuts follow in
// QuickActions, the categories and the newest posts after that, so the first
// phone screen is the search plus the next action, not a wall of headline.
export async function Hero({ compact = false }: { compact?: boolean } = {}) {
  const t = await getTranslator();
  const [line1, line2 = ""] = t("landing.searchHeadline").split("\n", 2);

  return (
    <HomeSearchProvider><section className="flex flex-col gap-2.5 rounded-3xl border border-border bg-muted/60 px-4 pt-5 pb-4 md:gap-4 md:px-10 md:py-10" data-home-hero>
      <h1 className="text-2xl leading-[1.25] font-extrabold tracking-[-0.03em] break-keep text-foreground sm:text-3xl md:text-[2.5rem] md:leading-[1.2]">
        <span className="block">{line1}</span>
        {line2 && <span className="block">{line2}</span>}
      </h1>

      <p className={`${compact ? "hidden md:block " : ""}max-w-xl text-sm leading-relaxed break-keep whitespace-pre-line text-muted-foreground md:text-base`}>
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
