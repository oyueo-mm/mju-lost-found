import type { ComponentType } from "react";

import { ChatIcon, EyeIcon, PlusIcon, SearchIcon, ShieldIcon } from "@/components/icons";
import { getTranslator } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/translate";
import { DemoPlayer } from "./DemoPlayer";
import { demoDelay } from "./demoDelay";

// Phase 30: a flat icon+text grid, deliberately without card borders/
// shadows -- five items would read as "template landing page" if each
// were boxed identically (this phase's own "avoid repeated cards"
// instruction). AI 검색·매칭 and 사진 검색 get their own deep-dive
// sections right after this one; this grid is only the at-a-glance list.
//
// 랜딩 애니메이션: on reveal, each icon makes one small motion that hints at
// its feature (the + turns, the magnifier sweeps, the AI-match icon sends
// a ring, the eye blinks, the chat bubble pops up), staggered left to
// right -- again each time the section comes back into view, never on a
// timer (DemoPlayer without loop). Hover lifts the icon a little.
const FEATURES: {
  Icon: ComponentType<{ className?: string }>;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  motion: string;
}[] = [
  { Icon: PlusIcon, titleKey: "landing.feature.register.title", descriptionKey: "landing.feature.register.description", motion: "demo-icon-rotate" },
  { Icon: SearchIcon, titleKey: "landing.feature.search.title", descriptionKey: "landing.feature.search.description", motion: "demo-icon-sweep" },
  { Icon: ShieldIcon, titleKey: "landing.feature.ai.title", descriptionKey: "landing.feature.ai.description", motion: "demo-pop" },
  { Icon: EyeIcon, titleKey: "landing.feature.image.title", descriptionKey: "landing.feature.image.description", motion: "demo-icon-blink" },
  { Icon: ChatIcon, titleKey: "landing.feature.chat.title", descriptionKey: "landing.feature.chat.description", motion: "demo-icon-bob" },
];
const ICON_STAGGER_MS = 110;

export async function FeatureGrid() {
  const t = await getTranslator();

  return (
    <section className="flex flex-col gap-8 py-14 md:py-20">
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-xl font-bold text-foreground md:text-2xl">{t("landing.features.title")}</h2>
        <p className="text-sm text-muted-foreground md:text-base">{t("landing.features.subtitle")}</p>
      </div>

      <DemoPlayer durationMs={1700}>
        <ul className="grid grid-cols-1 gap-x-8 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <li key={feature.titleKey} className="group flex flex-col items-start gap-3">
              <span className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-muted text-primary transition duration-200 group-hover:bg-primary group-hover:text-primary-foreground motion-safe:group-hover:-translate-y-0.5">
                {feature.motion === "demo-pop" && (
                  <span
                    aria-hidden
                    className="demo-ring absolute inset-0 rounded-full border-2 border-primary"
                    style={demoDelay(400 + index * ICON_STAGGER_MS + 150)}
                  />
                )}
                <span className={`flex ${feature.motion}`} style={demoDelay(400 + index * ICON_STAGGER_MS)}>
                  <feature.Icon className="size-5" />
                </span>
              </span>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-semibold text-foreground">{t(feature.titleKey)}</p>
                <p className="text-sm text-muted-foreground">{t(feature.descriptionKey)}</p>
              </div>
            </li>
          ))}
        </ul>
      </DemoPlayer>
    </section>
  );
}
