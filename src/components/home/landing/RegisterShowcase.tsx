import { CameraIcon, CheckIcon, InfoIcon, WalletIcon } from "@/components/icons";
import { getTranslator } from "@/lib/i18n/server";
import { DemoPlayer } from "./DemoPlayer";
import { demoDelay } from "./demoDelay";

// 랜딩 애니메이션 (게시글 등록): a static mockup of the real post form, in
// the same order the form asks for things -- lost or found, title,
// category, place and date, photos, then 등록하기 and the "posted"
// message. DemoPlayer fills it in step by step when it comes into view
// and replays it while on screen (see globals.css "Landing demos"). The
// labels are the form's own translation keys; the example values are
// made-up item details with no personal data. Nothing here posts
// anything, and the note under the copy says posting needs a sign-in.
export async function RegisterShowcase() {
  const t = await getTranslator();
  const label = "text-[11px] font-medium text-muted-foreground";
  const field = "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground";

  return (
    <section className="rounded-card border border-border bg-card px-6 py-10 shadow-sm md:px-12 md:py-14">
      <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-2 md:gap-16">
        <div className="flex flex-col gap-3 text-center md:text-left">
          <span className="text-xs font-medium text-primary">{t("landing.register.badge")}</span>
          <h2 className="text-xl font-bold text-foreground md:text-2xl">{t("landing.register.title")}</h2>
          <p className="text-sm text-muted-foreground md:text-base">{t("landing.register.description")}</p>
          <p className="flex items-start justify-center gap-1.5 text-xs text-muted-foreground md:justify-start">
            <InfoIcon className="mt-px size-3.5 shrink-0" />
            {t("landing.register.loginNote")}
          </p>
        </div>

        <DemoPlayer loop decorative durationMs={4000} className="flex flex-col gap-3 rounded-card border border-border bg-background/60 p-4 md:p-5">
          {/* 분실물 / 습득물 */}
          <div className="relative grid grid-cols-2 rounded-full border border-border bg-card p-1 text-center text-xs font-medium">
            <span className="py-1.5 text-muted-foreground">{t("post.type.lost")}</span>
            <span className="relative py-1.5 text-muted-foreground">
              {t("post.type.found")}
              <span
                className="demo-pop absolute inset-0 flex items-center justify-center rounded-full bg-primary text-primary-foreground"
                style={demoDelay(300)}
              >
                {t("post.type.found")}
              </span>
            </span>
          </div>

          {/* 제목 */}
          <div className="flex flex-col gap-1">
            <span className={label}>{t("form.title")}</span>
            <p className={`${field} truncate`}>
              <span className="demo-type inline-block" style={demoDelay(700)}>
                {t("landing.register.sampleTitle")}
              </span>
            </p>
          </div>

          {/* 카테고리 */}
          <div className="flex flex-col gap-1">
            <span className={label}>{t("form.category")}</span>
            <div className="flex flex-wrap gap-1.5">
              <span className="demo-pop flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground" style={demoDelay(1700)}>
                <WalletIcon className="size-3.5" />
                {t("taxonomy.category.wallet")}
              </span>
              <span className="demo-pop rounded-full border border-primary px-2.5 py-1 text-xs font-medium text-primary" style={demoDelay(1880)}>
                {t("taxonomy.subcategory.wallet.bifold")}
              </span>
            </div>
          </div>

          {/* 장소 · 날짜 */}
          <div className="grid grid-cols-2 gap-2">
            <div className="demo-rise flex min-w-0 flex-col gap-1" style={demoDelay(2200)}>
              <span className={label}>{t("form.foundLocation")}</span>
              <p className={`${field} truncate`}>{t("landing.register.sampleLocation")}</p>
            </div>
            <div className="demo-rise flex min-w-0 flex-col gap-1" style={demoDelay(2350)}>
              <span className={label}>{t("form.foundDate")}</span>
              <p className={`${field} truncate`}>{t("landing.register.sampleDate")}</p>
            </div>
          </div>

          {/* 사진 */}
          <div className="flex flex-col gap-1">
            <span className={label}>{t("form.photos")}</span>
            <div className="flex gap-2">
              {[0, 1].map((i) => (
                <span
                  key={i}
                  className="demo-drop flex size-12 items-center justify-center rounded-lg bg-primary-muted text-primary"
                  style={demoDelay(2650 + i * 150)}
                >
                  <WalletIcon className="size-5" />
                </span>
              ))}
              <span className="flex size-12 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
                <CameraIcon className="size-4" />
              </span>
            </div>
          </div>

          {/* 등록하기 -> 등록 완료 */}
          <span
            className="demo-press mt-1 flex h-10 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground"
            style={demoDelay(3200)}
          >
            {t("form.create")}
          </span>
          <p
            className="demo-rise flex items-center justify-center gap-1.5 rounded-lg bg-success-muted px-3 py-2 text-xs font-medium text-success"
            style={demoDelay(3550)}
          >
            <CheckIcon className="size-3.5 shrink-0" />
            {t("post.created")}
          </p>
        </DemoPlayer>
      </div>
    </section>
  );
}
