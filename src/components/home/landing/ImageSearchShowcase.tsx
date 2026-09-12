import { ChevronRightIcon, HandboxIcon, PlusIcon } from "@/components/icons";
import { getTranslator } from "@/lib/i18n/server";

// Phase 30: same "static mockup, no real API call" rule as
// AiSearchShowcase -- the upload box and the two result thumbnails are
// fixed placeholders that only illustrate the idea (a photo in, similar
// posts out). Real image-similarity search is untouched elsewhere.
export async function ImageSearchShowcase() {
  const t = await getTranslator();

  return (
    <section className="rounded-card border border-border bg-card px-6 py-10 shadow-sm md:px-12 md:py-14">
      <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-2 md:gap-16">
        <div className="order-2 flex flex-col gap-3 text-center md:order-1 md:text-left">
          <span className="text-xs font-medium text-primary">{t("landing.imageShowcase.badge")}</span>
          <h2 className="text-xl font-bold text-foreground md:text-2xl">{t("landing.imageShowcase.title")}</h2>
          <p className="text-sm text-muted-foreground md:text-base">
            {t("landing.imageShowcase.description")}
          </p>
        </div>

        <div className="order-1 flex items-center justify-center gap-3 md:order-2 md:gap-4">
          <div className="flex size-24 shrink-0 flex-col items-center justify-center gap-1 rounded-card border border-dashed border-border text-muted-foreground md:size-28">
            <PlusIcon className="size-5" />
            <span className="text-xs">{t("landing.imageShowcase.pickPhoto")}</span>
          </div>

          <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />

          <div className="grid grid-cols-2 gap-2">
            {[0, 1].map((i) => (
              <span
                key={i}
                className="flex size-11 items-center justify-center rounded-card border border-border bg-primary-muted text-primary md:size-12"
              >
                <HandboxIcon className="size-4.5" />
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
