import { getPostStats } from "@/lib/posts/service";
import { LinkButton } from "@/components/ui/Button";
import { BoxIcon, HandboxIcon } from "@/components/icons";
import { getTranslator } from "@/lib/i18n/server";

// Phase P-4: real DB counts (getPostStats(), never a hardcoded/mock
// number -- see this phase's own spec), placed right after the Hero so a
// first-time visitor sees "이 안에 진짜 내 물건이 있을 수도 있겠다" before
// anything else, then a direct path into the boards it's counting. Flat
// numbers, no bordered tiles -- same "avoid repeated cards" rule
// FeatureGrid.tsx's own comment already follows, so this doesn't read as
// a fourth boxed section in a row.
export async function LandingStats() {
  const t = await getTranslator();
  let stats: Awaited<ReturnType<typeof getPostStats>> | null = null;
  try {
    stats = await getPostStats();
  } catch (error) {
    console.error("Failed to load landing stats", error);
  }

  // No fabricated numbers if the query fails -- the section simply
  // doesn't render rather than show a fake 0 or placeholder count.
  if (!stats) return null;

  const { lostCount, foundCount, recentCount } = stats;
  const totalCount = lostCount + foundCount;
  if (totalCount === 0) return null;

  return (
    <section className="flex flex-col items-center gap-6 py-6 text-center md:py-8">
      <div className="grid w-full max-w-md grid-cols-3 gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-2xl font-bold text-foreground md:text-3xl">{lostCount.toLocaleString()}</span>
          <span className="text-xs text-muted-foreground md:text-sm">{t("landing.stats.lost")}</span>
        </div>
        <div className="flex flex-col gap-1 border-x border-border">
          <span className="text-2xl font-bold text-foreground md:text-3xl">{foundCount.toLocaleString()}</span>
          <span className="text-xs text-muted-foreground md:text-sm">{t("landing.stats.found")}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-2xl font-bold text-primary md:text-3xl">{recentCount.toLocaleString()}</span>
          <span className="text-xs text-muted-foreground md:text-sm">{t("landing.stats.recent")}</span>
        </div>
      </div>

      <p className="max-w-sm text-sm text-muted-foreground md:text-base">
        {t("landing.stats.summaryPrefix")}
        <span className="font-semibold text-foreground">
          {t("landing.stats.summaryCount", { count: totalCount.toLocaleString() })}
        </span>
        {t("landing.stats.summarySuffix")}
      </p>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <LinkButton href="/lost" variant="secondary" size="sm" className="gap-1.5">
          <BoxIcon className="size-4" /> {t("landing.stats.browseLost")}
        </LinkButton>
        <LinkButton href="/found" variant="secondary" size="sm" className="gap-1.5">
          <HandboxIcon className="size-4" /> {t("landing.stats.browseFound")}
        </LinkButton>
      </div>
    </section>
  );
}
