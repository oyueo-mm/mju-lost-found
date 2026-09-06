import { Fragment, type ComponentType } from "react";

import { ChatIcon, ChevronRightIcon, PlusIcon, SearchIcon, ShieldIcon } from "@/components/icons";

const STEPS: { Icon: ComponentType<{ className?: string }>; label: string }[] = [
  { Icon: PlusIcon, label: "등록" },
  { Icon: SearchIcon, label: "검색" },
  { Icon: ShieldIcon, label: "AI 매칭" },
  { Icon: ChatIcon, label: "채팅" },
];

export function HowItWorks() {
  return (
    <section className="flex flex-col gap-8 py-14 md:py-20">
      <h2 className="text-center text-xl font-bold text-foreground md:text-2xl">이용 방법은 간단해요</h2>

      <div className="flex flex-col items-center gap-3 md:flex-row md:justify-center">
        {STEPS.map((step, index) => (
          <Fragment key={step.label}>
            <div className="flex flex-col items-center gap-2">
              <span className="flex size-14 items-center justify-center rounded-full border border-border bg-card text-primary shadow-sm">
                <step.Icon className="size-5.5" />
              </span>
              <p className="text-sm font-medium text-foreground">{step.label}</p>
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
