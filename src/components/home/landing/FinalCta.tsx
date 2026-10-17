import { LinkButton } from "@/components/ui/Button";
import { getTranslator } from "@/lib/i18n/server";

// Phase K: the id lets LandingStickyCta hide its floating button while
// this section is on screen, so the page never shows the same button
// twice. Search first (no sign-in needed), posting a found item second.
export async function FinalCta() {
  const t = await getTranslator();

  return (
    <section
      id="landing-final-cta"
      className="flex flex-col items-center gap-5 rounded-card border border-border bg-primary-muted/40 px-6 py-14 text-center md:py-16"
    >
      <h2 className="max-w-md text-2xl font-bold text-balance text-foreground md:text-3xl">
        {t("landing.finalCta.title")}
      </h2>
      <p className="max-w-sm text-sm text-muted-foreground md:text-base">
        {t("landing.finalCta.description")}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <LinkButton href="/search" size="md" className="px-8 hover:shadow-md motion-safe:hover:-translate-y-0.5">
          {t("landing.searchCta")}
        </LinkButton>
        <LinkButton href="/found/new" variant="secondary" size="md">
          {t("landing.registerFound")}
        </LinkButton>
      </div>
    </section>
  );
}
