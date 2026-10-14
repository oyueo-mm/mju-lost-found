import { Fragment, type ComponentType } from "react";

import { ChatIcon, ChevronRightIcon, PlusIcon, SearchIcon, ShieldIcon } from "@/components/icons";
import { getTranslator } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/translate";
import { demoDelay } from "./demoDelay";

const STEPS: { Icon: ComponentType<{ className?: string }>; labelKey: TranslationKey }[] = [
  { Icon: PlusIcon, labelKey: "landing.how.register" },
  { Icon: SearchIcon, labelKey: "landing.how.search" },
  { Icon: ShieldIcon, labelKey: "landing.how.match" },
  { Icon: ChatIcon, labelKey: "landing.how.chat" },
];

// 랜딩 애니메이션: on reveal the steps light up in order (register ->
// search -> AI match -> chat), and the AI-match step sends out one soft
// ring -- the moment two posts are connected. Once; see globals.css.
const STEP_GAP_MS = 380;
const MATCH_STEP = 2;

export async function HowItWorks() {
  const t = await getTranslator();

  return (
    <section className="flex flex-col gap-8 py-14 md:py-20">
      <h2 className="text-center text-xl font-bold text-foreground md:text-2xl">{t("landing.how.title")}</h2>

      <div className="flex flex-col items-center gap-3 md:flex-row md:justify-center">
        {STEPS.map((step, index) => (
          <Fragment key={step.labelKey}>
            <div className="flex flex-col items-center gap-2">
              <span className="relative flex size-14 items-center justify-center">
                {index === MATCH_STEP && (
                  <span
                    aria-hidden
                    className="demo-ring absolute inset-0 rounded-full border-2 border-primary"
                    style={demoDelay(300 + index * STEP_GAP_MS + 200)}
                  />
                )}
                <span
                  className="demo-step flex size-14 items-center justify-center rounded-full border border-border bg-card text-primary shadow-sm"
                  style={demoDelay(300 + index * STEP_GAP_MS)}
                >
                  <step.Icon className="size-5.5" />
                </span>
              </span>
              <p className="text-sm font-medium text-foreground">{t(step.labelKey)}</p>
            </div>
            {index < STEPS.length - 1 && (
              <span className="demo-pop shrink-0 md:mx-2" style={demoDelay(300 + index * STEP_GAP_MS + STEP_GAP_MS / 2)}>
                <ChevronRightIcon className="size-5 rotate-90 text-muted-foreground md:rotate-0" />
              </span>
            )}
          </Fragment>
        ))}
      </div>
    </section>
  );
}
