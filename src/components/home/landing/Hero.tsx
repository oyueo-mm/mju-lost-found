import { HomeSearchBar } from "@/components/home/HomeSearchBar";
import { LinkButton } from "@/components/ui/Button";
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
export async function Hero() {
  const t = await getTranslator();
  const [line1, line2 = ""] = t("landing.searchHeadline").split("\n", 2);

  return (
    <section className="relative isolate -mx-4 -mt-6 flex flex-col items-center gap-4 overflow-hidden px-4 pt-10 pb-4 text-center md:-mx-6 md:-mt-10 md:gap-5 md:px-6 md:pt-16 md:pb-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_90%_75%_at_50%_0%,var(--primary-muted),transparent)] md:bg-[radial-gradient(ellipse_44%_85%_at_50%_0%,var(--primary-muted),transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 left-1/2 -z-10 h-72 w-72 -translate-x-1/2 -translate-y-1/3 rounded-full bg-primary/10 blur-3xl md:h-96 md:w-96"
      />

      <h1 className="text-[1.875rem] leading-[1.22] font-extrabold tracking-[-0.03em] break-keep text-foreground sm:text-4xl md:text-[3.25rem] md:leading-[1.15]">
        <span className="block">{line1}</span>
        {line2 && <span className="text-headline-accent block">{line2}</span>}
      </h1>

      <p className="max-w-sm text-[0.9375rem] leading-relaxed break-keep whitespace-pre-line text-muted-foreground md:max-w-md md:text-base">
        {t("landing.subtitle")}
      </p>

      {/* The search itself. The id is what LandingStickyCta watches: once
          this has scrolled away, its floating "find" button takes over. */}
      <div id="landing-hero-cta" className="mt-1 w-full max-w-xl text-left">
        <HomeSearchBar variant="landing" />
      </div>

      <div className="grid w-full max-w-xs grid-cols-2 gap-2 sm:max-w-sm">
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
            className="h-auto min-h-9 bg-card/60 px-3 py-1.5 text-[0.8125rem] leading-tight whitespace-normal text-muted-foreground hover:text-foreground"
          >
            {t(key)}
          </LinkButton>
        ))}
      </div>
    </section>
  );
}
