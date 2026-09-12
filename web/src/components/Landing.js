import Link from "next/link";
import { getT } from "@/i18n/server";
import LogoMark from "./LogoMark";
import Icon from "./Icon";
import LandingStats from "./LandingStats";
import { SearchDemo, ImageDemo } from "./LandingDemo";

const FEATURES = [
  { icon: "package", key: "f1" },
  { icon: "search", key: "f2" },
  { icon: "sparkle", key: "f3" },
  { icon: "camera", key: "f4" },
  { icon: "chat", key: "f5" },
];

const STEPS = ["s1", "s2", "s3", "s4"];

export default async function Landing() {
  const t = await getT();

  return (
    <div>
      {/* 히어로 — 데스크톱은 카피 + AI 검색 미리보기 2열 */}
      <section className="pt-3 md:grid md:grid-cols-[minmax(0,1fr)_300px] md:items-center md:gap-10">
        <div>
          <LogoMark size={38} rounded="rounded-xl" />
          <h1 className="mt-6 text-[2rem] font-extrabold leading-[1.28] tracking-[-0.035em]">
            {t("landing.h1a")}
            <br />
            {t("landing.h1b_pre")}
            <span className="text-brand">AI</span>
            {t("landing.h1b_post")}
          </h1>
          <p className="mt-3.5 text-[15px] leading-relaxed text-ink-soft">
            {t("landing.sub1")}
            <br />
            {t("landing.sub2")}
          </p>
          <Link
            href="/login"
            className="btn btn-primary mt-7 w-full px-5 py-3.5 text-[15px] md:w-auto"
          >
            {t("landing.cta")}
          </Link>
          <p className="mt-2.5 text-xs text-ink-faint">{t("landing.ctaNote")}</p>
        </div>

        <div className="mt-8 md:mt-0">
          <SearchDemo t={t} />
        </div>
      </section>

      {/* 숫자 + 둘러보기 */}
      <div className="mt-8 border-t border-line pt-6">
        <LandingStats />
        <div className="mt-5 grid grid-cols-2 gap-2">
          {/* 게시판은 로그인 필요 — 로그인 후 "/" 가 게시판 */}
          <Link href="/login" className="btn btn-ghost px-4 py-2.5 text-sm">
            <Icon name="package" size={15} />
            {t("landing.browseFound")}
          </Link>
          <Link href="/login" className="btn btn-ghost px-4 py-2.5 text-sm">
            <Icon name="search" size={15} />
            {t("landing.browseLost")}
          </Link>
        </div>
      </div>

      {/* 기능 */}
      <section className="mt-9">
        <p className="kicker text-brand">{t("landing.features")}</p>
        <div className="mt-2 card divide-y divide-line-soft overflow-hidden">
          {FEATURES.map((f) => (
            <div key={f.key} className="flex gap-3.5 p-4 sm:p-5">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sunken text-ink-soft">
                <Icon name={f.icon} size={18} />
              </div>
              <div className="min-w-0">
                <h2 className="font-bold">{t(`landing.${f.key}.title`)}</h2>
                <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">
                  {t(`landing.${f.key}.desc`)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 이미지 검색 시연 */}
      <section className="mt-9">
        <p className="kicker text-brand">{t("landing.imgKicker")}</p>
        <h2 className="mt-1.5 text-xl font-extrabold tracking-tight">
          {t("landing.imgTitle")}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
          {t("landing.imgDesc")}
        </p>
        <div className="mt-4">
          <ImageDemo t={t} />
        </div>
      </section>

      {/* 이용 방법 */}
      <section className="mt-9">
        <p className="kicker text-brand">{t("landing.how")}</p>
        <ol className="mt-3 grid gap-2 sm:grid-cols-4">
          {STEPS.map((s, i) => (
            <li
              key={s}
              className="card flex items-center gap-3 p-4 sm:flex-col sm:items-start sm:gap-2.5"
            >
              <span className="num grid h-7 w-7 shrink-0 place-items-center rounded-md bg-brand text-xs font-bold text-white">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="font-bold">{t(`landing.${s}.title`)}</p>
                <p className="mt-0.5 text-[13px] leading-snug text-ink-soft">
                  {t(`landing.${s}.desc`)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* 마지막 CTA */}
      <section className="mt-10 rounded-[var(--radius)] bg-brand px-6 py-7 text-center text-white">
        <h2 className="text-xl font-extrabold tracking-tight">{t("landing.finalTitle")}</h2>
        <p className="mt-1.5 text-sm text-white/80">{t("landing.finalSub")}</p>
        <Link
          href="/login"
          className="btn mt-5 bg-white px-6 py-3 text-[15px] text-brand hover:bg-brand-tint"
        >
          {t("landing.cta")}
          <Icon name="arrowRight" size={16} />
        </Link>
      </section>
    </div>
  );
}
