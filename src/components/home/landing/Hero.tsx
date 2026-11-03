import { HomeSearchBar } from "@/components/home/HomeSearchBar";
import { LinkButton } from "@/components/ui/Button";
import { BoxIcon, ChevronRightIcon, HandboxIcon } from "@/components/icons";
import { getTranslator } from "@/lib/i18n/server";

// The home's first screen, signed in or out (app/(main)/page.tsx): a two-line
// headline (second line in the brand colour), one short line on what the
// search does, and the search itself -- the natural-language / photo search
// (HomeSearchBar, "landing" variant: no repeated hint). Posting a lost or a
// found item is the second action, as two quiet outline buttons (signed out:
// the usual sign-in, then back to the form via callbackUrl; signed in:
// straight to the form).
//
// Background: the blue glow starts right under the header. The section
// cancels <main>'s top padding (-mt) and, on phones, its side padding (-mx)
// so the gradient reaches the screen edges; from md up the page is wider
// than the content column, so the gradient is narrower and has faded out
// before the column's edges (no visible cut). The content keeps its own
// top spacing (pt). No new animation.
// 모바일 홈 밀도 개선: less top space and a smaller headline on phones so the
// search, the boards and posting are on the first screen; `compact` (signed
// in) also drops the subtitle on phones. Right under the search: 찾기 (the two
// boards, plain links) and 등록 (the two forms, buttons) -- one row each, so
// browsing and posting never look alike.
export async function Hero({ compact = false }: { compact?: boolean } = {}) {
  const t = await getTranslator();
  const [line1, line2 = ""] = t("landing.searchHeadline").split("\n", 2);

  return (
    <section className="relative isolate -mx-4 -mt-6 flex flex-col items-center gap-3 overflow-hidden px-4 pt-6 pb-3 text-center md:-mx-6 md:-mt-10 md:gap-5 md:px-6 md:pt-16 md:pb-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_90%_75%_at_50%_0%,var(--primary-muted),transparent)] md:bg-[radial-gradient(ellipse_44%_85%_at_50%_0%,var(--primary-muted),transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 left-1/2 -z-10 h-72 w-72 -translate-x-1/2 -translate-y-1/3 rounded-full bg-primary/10 blur-3xl md:h-96 md:w-96"
      />

      <h1 className="text-[1.625rem] leading-[1.22] font-extrabold tracking-[-0.03em] break-keep text-foreground sm:text-4xl md:text-[3.25rem] md:leading-[1.15]">
        <span className="block">{line1}</span>
        {line2 && <span className="text-headline-accent block">{line2}</span>}
      </h1>

      <p className={`${compact ? "hidden md:block " : ""}max-w-sm text-[0.9375rem] leading-relaxed break-keep whitespace-pre-line text-muted-foreground md:max-w-md md:text-base`}>
        {t("landing.subtitle")}
      </p>

      {/* The search itself. The id is what LandingStickyCta watches: once
          this has scrolled away, its floating "find" button takes over. */}
      <div id="landing-hero-cta" className="mt-1 w-full max-w-xl text-left">
        <HomeSearchBar variant="landing" />
      </div>

      <nav aria-label={t("landing.stats.browseFound") + " · " + t("landing.stats.browseLost")} className="grid w-full max-w-sm grid-cols-2 gap-2">
        {(
          [
            ["/found", "landing.stats.browseFound", HandboxIcon],
            ["/lost", "landing.stats.browseLost", BoxIcon],
          ] as const
        ).map(([href, key, Icon]) => (
          <LinkButton key={href} href={href} variant="ghost" size="sm" className="h-auto min-h-11 gap-1 px-1.5 text-[0.8125rem] leading-tight whitespace-nowrap text-foreground hover:bg-muted/60">
            <Icon className="size-4 shrink-0" /> {t(key)}
            <ChevronRightIcon className="hidden size-3.5 shrink-0 min-[360px]:inline" />
          </LinkButton>
        ))}
      </nav>

      <div className="grid w-full max-w-sm grid-cols-2 gap-2">
        {(
          [
            ["/lost/new", "landing.registerLost"],
            ["/found/new", "landing.registerFound"],
          ] as const
        ).map(([href, key]) => (
          <LinkButton
            key={href}
            href={href}
            variant="secondary"
            size="sm"
            className="h-auto min-h-11 bg-card/60 px-3 py-1.5 text-[0.8125rem] leading-tight whitespace-normal text-muted-foreground hover:text-foreground"
          >
            {t(key)}
          </LinkButton>
        ))}
      </div>
    </section>
  );
}
