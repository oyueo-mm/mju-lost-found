import { Fragment, type ComponentType } from "react";

import { ChatIcon, ChevronRightIcon, PlusIcon, SearchIcon, ShieldIcon } from "@/components/icons";
import { getTranslator } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/translate";

const STEPS: { Icon: ComponentType<{ className?: string }>; labelKey: TranslationKey }[] = [
  { Icon: PlusIcon, labelKey: "landing.how.register" },
  { Icon: SearchIcon, labelKey: "landing.how.search" },
  { Icon: ShieldIcon, labelKey: "landing.how.match" },
  { Icon: ChatIcon, labelKey: "landing.how.chat" },
];

export async function HowItWorks() {
  const t = await getTranslator();

  return (
    <section className="flex flex-col gap-8 py-14 md:py-20">
      <h2 className="text-center text-xl font-bold text-foreground md:text-2xl">{t("landing.how.title")}</h2>

      <div className="flex flex-col items-center gap-3 md:flex-row md:justify-center">
        {STEPS.map((step, index) => (
          <Fragment key={step.labelKey}>
            <div className="flex flex-col items-center gap-2">
              <span className="flex size-14 items-center justify-center rounded-full border border-border bg-card text-primary shadow-sm">
                <step.Icon className="size-5.5" />
              </span>
              <p className="text-sm font-medium text-foreground">{t(step.labelKey)}</p>
            </div>
            {index < STEPS.length - 1 && (
              <ChevronRightIcon className="size-5 shrink-0 rotate-90 text-muted-foreground md:mx-2 md:rotate-0" />
            )}
          </Fragment>
        ))}
      </div>
    </section>
  );
}
