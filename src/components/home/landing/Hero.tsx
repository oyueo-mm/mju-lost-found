import { LinkButton } from "@/components/ui/Button";
import { getTranslator } from "@/lib/i18n/server";

// Phase 30: the page's first viewport -- a soft, blurred blue glow behind
// the copy (pure decoration, `pointer-events-none` + `-z-10`) is the only
// "visual flourish" here, kept faint (10% opacity) per this phase's own
// "no heavy gradients" rule. Everything else is just large type + one CTA.
export async function Hero() {
  const t = await getTranslator();

  return (
    <section className="relative flex flex-col items-center gap-6 overflow-hidden px-2 pt-10 pb-4 text-center md:gap-8 md:pt-16">
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 left-1/2 -z-10 h-72 w-72 -translate-x-1/2 -translate-y-1/3 rounded-full bg-primary/10 blur-3xl md:h-96 md:w-96"
      />

      <span className="rounded-full bg-primary-muted px-3 py-1 text-xs font-medium text-primary">
        {t("landing.badge")}
      </span>

      <h1 className="max-w-2xl text-3xl leading-tight font-bold text-balance text-foreground md:text-5xl">
        {t("landing.headline1")}
        <br />
        <span className="text-primary">{t("landing.headlineAi")}</span>
        {t("landing.headline2")}
      </h1>

      <p className="max-w-md text-sm text-muted-foreground md:max-w-lg md:text-base">
        {t("landing.subtitle")}
      </p>

      {/* Phase K: the id is what LandingStickyCta watches to know this CTA
          has scrolled away (and its floating copy should take over).
          Wrapper only -- the button itself is unchanged. */}
      <div id="landing-hero-cta" className="mt-2">
        <LinkButton href="/login" size="md" className="px-8">
          {t("landing.cta")}
        </LinkButton>
      </div>
    </section>
  );
}
