import { LinkButton } from "@/components/ui/Button";
import { getTranslator } from "@/lib/i18n/server";

// Phase K: the id lets LandingStickyCta hide its floating button while
// this section is on screen, so the page never shows two "로그인하고
// 시작하기" buttons at once. Styling unchanged.
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
      <LinkButton href="/login" size="md" className="px-8">
        {t("landing.cta")}
      </LinkButton>
    </section>
  );
}
