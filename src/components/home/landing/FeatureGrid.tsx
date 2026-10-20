import type { ComponentType } from "react";

import { CameraIcon, ChatIcon, PlusIcon, SearchIcon, ShieldIcon } from "@/components/icons";
import { getTranslator } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/translate";
import { DemoPlayer } from "./DemoPlayer";
import { demoDelay } from "./demoDelay";

// Phase 30: a flat icon+text grid, deliberately without card borders/
// shadows -- five items would read as "template landing page" if each
// were boxed identically (this phase's own "avoid repeated cards"
// instruction). 설명·사진 검색 and 추천 get their own deep-dive sections
// after this one; this grid is only the at-a-glance list: 등록, 키워드
// 검색, 설명·사진 검색, 추천, 채팅.
//
// Phones: one compact row per feature -- icon left, title and one line of
// description right -- in a light card each, so five features read as five
// separate things without a long icon-over-text column. From sm up: the
// open grid as before.
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
  { Icon: CameraIcon, titleKey: "landing.feature.ai.title", descriptionKey: "landing.feature.ai.description", motion: "demo-icon-blink" },
  { Icon: ShieldIcon, titleKey: "landing.feature.recommend.title", descriptionKey: "landing.feature.recommend.description", motion: "demo-pop" },
  { Icon: ChatIcon, titleKey: "landing.feature.chat.title", descriptionKey: "landing.feature.chat.description", motion: "demo-icon-bob" },
];
const ICON_STAGGER_MS = 110;

export async function FeatureGrid() {
  const t = await getTranslator();

  // top kept short: the stats' browse links sit right above it
  return (
    <section className="flex flex-col gap-6 pt-8 pb-10 sm:gap-8 sm:pt-10 sm:pb-14 md:pt-14 md:pb-20">
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-xl font-bold text-foreground md:text-2xl">{t("landing.features.title")}</h2>
        <p className="text-sm [&:lang(ko)]:break-keep text-muted-foreground md:text-base">{t("landing.features.subtitle")}</p>
      </div>

      <DemoPlayer durationMs={1700}>
        <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-x-8 sm:gap-y-9 lg:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <li
              key={feature.titleKey}
              className="group flex items-center gap-3.5 rounded-card border border-border bg-card px-4 py-3.5 sm:flex-col sm:items-start sm:gap-3 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0"
            >
              <span className="relative flex size-10 shrink-0 sm:size-11 items-center justify-center rounded-full bg-primary-muted text-primary transition duration-200 group-hover:bg-primary group-hover:text-primary-foreground motion-safe:group-hover:-translate-y-0.5">
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
              <div className="flex min-w-0 flex-col gap-0.5 sm:gap-1">
                <p className="text-sm font-semibold [&:lang(ko)]:break-keep text-foreground">{t(feature.titleKey)}</p>
                <p className="text-[0.8125rem] leading-snug [&:lang(ko)]:break-keep text-muted-foreground sm:text-sm sm:leading-normal">{t(feature.descriptionKey)}</p>
              </div>
            </li>
          ))}
        </ul>
      </DemoPlayer>
    </section>
  );
}
