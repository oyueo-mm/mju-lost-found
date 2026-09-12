import type { ComponentType } from "react";

import { ChatIcon, EyeIcon, PlusIcon, SearchIcon, ShieldIcon } from "@/components/icons";
import { getTranslator } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/translate";

// Phase 30: a flat icon+text grid, deliberately without card borders/
// shadows -- five items would read as "template landing page" if each
// were boxed identically (this phase's own "avoid repeated cards"
// instruction). AI 검색·매칭 and 사진 검색 get their own deep-dive
// sections right after this one; this grid is only the at-a-glance list.
const FEATURES: {
  Icon: ComponentType<{ className?: string }>;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
}[] = [
  { Icon: PlusIcon, titleKey: "landing.feature.register.title", descriptionKey: "landing.feature.register.description" },
  { Icon: SearchIcon, titleKey: "landing.feature.search.title", descriptionKey: "landing.feature.search.description" },
  { Icon: ShieldIcon, titleKey: "landing.feature.ai.title", descriptionKey: "landing.feature.ai.description" },
  { Icon: EyeIcon, titleKey: "landing.feature.image.title", descriptionKey: "landing.feature.image.description" },
  { Icon: ChatIcon, titleKey: "landing.feature.chat.title", descriptionKey: "landing.feature.chat.description" },
];

export async function FeatureGrid() {
  const t = await getTranslator();

  return (
    <section className="flex flex-col gap-8 py-14 md:py-20">
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-xl font-bold text-foreground md:text-2xl">{t("landing.features.title")}</h2>
        <p className="text-sm text-muted-foreground md:text-base">{t("landing.features.subtitle")}</p>
      </div>

      <ul className="grid grid-cols-1 gap-x-8 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <li key={feature.titleKey} className="flex flex-col items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-muted text-primary">
              <feature.Icon className="size-5" />
            </span>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-foreground">{t(feature.titleKey)}</p>
              <p className="text-sm text-muted-foreground">{t(feature.descriptionKey)}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
