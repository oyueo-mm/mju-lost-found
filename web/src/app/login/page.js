import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, isEmailPermitted } from "@/lib/auth";
import { getT } from "@/i18n/server";
import LoginButton from "./LoginButton";
import LogoMark from "@/components/LogoMark";
import LanguageSwitcher from "@/components/LanguageSwitcher";

const ERR_KEY = {
  domain: "login.err.domain",
  exchange: "login.err.exchange",
  missing_code: "login.err.missing",
};

function Step({ n, children }) {
  return (
    <li className="flex gap-2">
      <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-brand text-[10px] font-bold text-white">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

export default async function LoginPage({ searchParams }) {
  const sp = await searchParams;
  const t = await getT();

  const session = await getSessionUser();
  if (session && (await isEmailPermitted(session.user.email))) {
    redirect(session.profile?.nickname ? "/" : "/onboarding");
  }

  const error = sp?.error
    ? t(ERR_KEY[sp.error] || "login.err.generic") + (sp.d ? ` (${sp.d})` : "")
    : null;
  const isDomainError = sp?.error === "domain";
  const byeMessage = sp?.bye ? t("login.bye") : null;

  return (
    <main className="brand-wash flex min-h-dvh flex-col items-center justify-center px-5">
      <div className="card w-full max-w-sm p-8 text-center">
        <LogoMark size={52} rounded="rounded-xl" className="mx-auto" />
        <h1 className="mt-4 text-xl font-extrabold">{t("app.name")}</h1>
        <p className="mt-1.5 text-sm text-ink-soft">{t("login.sub")}</p>

        {byeMessage && (
          <p className="mt-5 rounded-lg bg-sunken px-3 py-2.5 text-sm text-ink-soft">
            {byeMessage}
          </p>
        )}

        {error && (
          <p className="mt-5 rounded-lg bg-brand-tint px-3 py-2.5 text-sm text-brand-deep">
            {error}
          </p>
        )}

        <div className="mt-7">
          <LoginButton />
        </div>

        <p className="mt-4 text-xs text-ink-faint">{t("login.onlyMju")}</p>

        <details
          open={isDomainError}
          className="group mt-5 rounded-lg border border-line text-left"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-ink-soft group-open:text-ink">
            <span>{t("login.howTitle")}</span>
            <span className="text-ink-faint transition group-open:rotate-90">›</span>
          </summary>
          <div className="space-y-3 px-4 pb-4 text-[13px] leading-relaxed text-ink-soft">
            <p>{t("login.howIntro")}</p>
            <ol className="space-y-2.5">
              <Step n={1}>{t("login.how1")}</Step>
              <Step n={2}>{t("login.how2")}</Step>
              <Step n={3}>{t("login.how3")}</Step>
            </ol>
            <div className="rounded-xl bg-brand-tint px-3 py-2.5 text-[12.5px] text-brand-deep">
              <b>{t("login.betaTitle")}</b> · {t("login.beta")}
            </div>
            <p className="text-ink-faint">
              {t("login.helpPre")}
              <Link href="/help" className="font-semibold text-brand-strong">
                {t("login.help")}
              </Link>
              {t("login.helpPost")}
            </p>
          </div>
        </details>

        <div className="mt-5 flex justify-center">
          <LanguageSwitcher />
        </div>
      </div>

      <p className="mt-6 text-xs text-ink-faint">{t("login.foot")}</p>
    </main>
  );
}
