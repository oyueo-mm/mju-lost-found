import type { ReactNode } from "react";

import { BellIcon, WalletIcon } from "@/components/icons";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { getTranslator } from "@/lib/i18n/server";
import { DemoPlayer } from "./DemoPlayer";
import { demoDelay } from "./demoDelay";

// 랜딩 애니메이션 (등록 이후): what happens after posting, as three small
// mockups -- an AI match connecting a lost post with a similar found post,
// a 1:1 chat to confirm the item, and an alert followed by the post moving
// from 보관 중 to 완료. Each card has its own ScrollReveal and DemoPlayer, so
// on a phone (cards stacked) each plays as it scrolls in; side by side on a
// desktop they play one after another (DemoPlayer's one-at-a-time rule). Example data only
// (no personal details); status labels and the "AI 유사도 0.87" score
// format are the app's own (PostCard's decimal AI score).
const CARD_CLASS =
  "flex h-full flex-col gap-4 rounded-card border border-border bg-card p-5 transition hover:border-foreground/30 hover:shadow-md motion-safe:hover:-translate-y-0.5";

function Card({
  title,
  description,
  durationMs,
  children,
}: {
  title: string;
  description: string;
  durationMs: number;
  children: ReactNode;
}) {
  return (
    <div className={CARD_CLASS}>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <DemoPlayer
        loop
        decorative
        durationMs={durationMs}
        className="mt-auto flex flex-col gap-2 rounded-card bg-muted/50 p-3"
      >
        {children}
      </DemoPlayer>
    </div>
  );
}

export async function AfterPostingShowcase() {
  const t = await getTranslator();
  const miniPost = "flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2";
  const typeTag = "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium";

  return (
    <section className="flex flex-col gap-8 py-14 md:py-20">
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-xl font-bold text-foreground md:text-2xl">{t("landing.after.title")}</h2>
        <p className="text-sm text-muted-foreground md:text-base">{t("landing.after.subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* AI 추천 매칭: lost post -> connector + score -> similar found post */}
        <ScrollReveal replay className="h-full">
          <Card
            title={t("landing.after.match.title")}
            description={t("landing.after.match.description")}
            durationMs={1600}
          >
            <div className={`demo-rise ${miniPost}`} style={demoDelay(300)}>
              <span className={`${typeTag} bg-muted text-muted-foreground`}>{t("post.type.lost")}</span>
              <span className="truncate text-xs text-foreground">{t("landing.after.match.lostTitle")}</span>
            </div>
            <div className="relative flex h-8 items-center justify-center">
              <span className="demo-draw absolute inset-y-0 left-1/2 w-px origin-top bg-primary" style={demoDelay(650)} />
              <span
                className="demo-pop relative rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-medium text-primary-foreground"
                style={demoDelay(1150)}
              >
                {t("post.score.ai")} 0.87
              </span>
            </div>
            <div className={`demo-rise ${miniPost}`} style={demoDelay(850)}>
              <span className={`${typeTag} bg-primary-muted text-primary`}>{t("post.type.found")}</span>
              <span className="truncate text-xs text-foreground">{t("landing.register.sampleTitle")}</span>
            </div>
          </Card>
        </ScrollReveal>

        {/* 1:1 채팅: lost-item owner (right) and finder (left) */}
        <ScrollReveal replay className="h-full" delayMs={70}>
          <Card
            title={t("landing.after.chat.title")}
            description={t("landing.after.chat.description")}
            durationMs={2100}
          >
            <p
              className="demo-rise max-w-[85%] self-end rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-xs text-primary-foreground"
              style={demoDelay(300)}
            >
              {t("landing.after.chat.message1")}
            </p>
            <p
              className="demo-rise max-w-[85%] self-start rounded-2xl rounded-bl-sm border border-border bg-card px-3 py-2 text-xs text-foreground"
              style={demoDelay(950)}
            >
              {t("landing.after.chat.message2")}
            </p>
            <p
              className="demo-rise max-w-[85%] self-end rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-xs text-primary-foreground"
              style={demoDelay(1600)}
            >
              {t("landing.after.chat.message3")}
            </p>
          </Card>
        </ScrollReveal>

        {/* 알림 -> 보관 중 becomes 완료 */}
        <ScrollReveal replay className="h-full" delayMs={140}>
          <Card
            title={t("landing.after.done.title")}
            description={t("landing.after.done.description")}
            durationMs={1900}
          >
            <div className="demo-drop flex items-center gap-2 rounded-lg bg-card px-2.5 py-2 shadow-sm" style={demoDelay(300)}>
              <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-muted text-primary">
                <BellIcon className="size-3.5" />
                <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-destructive" />
              </span>
              <span className="text-xs text-foreground">{t("landing.after.done.notification")}</span>
            </div>
            <div className={miniPost}>
              <WalletIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs text-foreground">{t("landing.register.sampleTitle")}</span>
              <span className="relative shrink-0">
                <span className={`demo-pop ${typeTag} block bg-success-muted text-success`} style={demoDelay(1450)}>
                  {t("status.완료")}
                </span>
                <span
                  className={`demo-out ${typeTag} absolute top-0 right-0 bg-muted whitespace-nowrap text-muted-foreground`}
                  style={demoDelay(1250)}
                >
                  {t("status.보관 중")}
                </span>
              </span>
            </div>
          </Card>
        </ScrollReveal>
      </div>
    </section>
  );
}
