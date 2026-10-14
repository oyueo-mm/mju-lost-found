import Link from "next/link";

import { auth } from "@/lib/auth/auth";
import { requireReadyUser, sanitizeCallbackUrl } from "@/lib/auth/session";
import { getOwnIdentityInfo, hasCurrentIdentityConsent } from "@/lib/identity/service";
import { getTranslator } from "@/lib/i18n/server";
import { Button } from "@/components/ui/Button";
import { consentIdentityAction, reloginForIdentityAction, withdrawIdentityConsentAction } from "./actions";
import { CorrectionRequestForm } from "./CorrectionRequestForm";
import { IdentityForm } from "./IdentityForm";

// 실명·소속. Collection is automatic -- this page only shows where a member
// stands (only the signed-in member's own values are ever loaded):
//
// 1. No consent for the current version -> one button: agree, and the name
//    and affiliation are taken from the Google display name at once (the
//    가입 동의 screen offers the same choice, so most members never see this).
// 2. Values collected from Google -> read-only, with how they are kept in
//    sync and a 정정 요청 form. Never presented as school-verified.
// 3. Consent, no values, and a session from before the Google hints -> sign
//    in again (hints come only with a sign-in).
// 4. Consent, and this account's Google name can't give them (not a school
//    Workspace account, or another name format) -> the exception path: the
//    member types them in (stored as "self"); nothing is ever invented.
export default async function IdentityPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; onboarding?: string }>;
}) {
  const user = await requireReadyUser("mypost", "/me/identity");
  const [t, own, params, session] = await Promise.all([getTranslator(), getOwnIdentityInfo(user.id), searchParams, auth()]);
  const callbackUrl = sanitizeCallbackUrl(params.callbackUrl) ?? null;
  const onboarding = params.onboarding === "1";
  const consented = hasCurrentIdentityConsent(user);
  const fromGoogle = own?.realNameSource === "google_display_name";
  const hints = session?.identityHints;

  const hidden = (
    <>
      {callbackUrl && <input type="hidden" name="callbackUrl" value={callbackUrl} />}
      {onboarding && <input type="hidden" name="onboarding" value="1" />}
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-foreground">{t("identity.formTitle")}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{t("identity.formIntro")}</p>
      </div>

      {callbackUrl && !(consented && own) && (
        <p className="rounded-card bg-primary-muted px-4 py-2.5 text-sm text-primary">{t("identity.redirectNotice")}</p>
      )}

      {!consented ? (
        // 1. consent -> automatic collection
        <section className="flex flex-col gap-3 rounded-card border border-border bg-card p-5 text-sm">
          <h2 className="font-semibold text-foreground">{t("identity.consentStep.title")}</h2>
          <p className="text-muted-foreground">{t("identity.consentStep.description")}</p>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-xs leading-relaxed text-muted-foreground">
            <li>{t("identity.consent.items")}</li>
            <li>{t("identity.consent.prefill")}</li>
            <li>{t("identity.consent.purpose")}</li>
            <li>{t("identity.consent.access")}</li>
            <li>{t("identity.consent.retention")}</li>
            <li>{t("identity.consent.refuse")}</li>
          </ul>
          <Link href="/policy/privacy" target="_blank" className="w-fit text-xs font-medium text-primary hover:opacity-80">
            {t("identity.policyLink")}
          </Link>
          <form action={consentIdentityAction} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {hidden}
            <Button type="submit" className="w-full sm:w-auto">
              {t("identity.consentStep.agree")}
            </Button>
            <Link href={callbackUrl ?? "/"} className="py-2 text-center text-sm text-muted-foreground hover:text-foreground sm:px-3">
              {t("identity.later")}
            </Link>
          </form>
        </section>
      ) : own && fromGoogle ? (
        // 2. read-only, kept in sync from Google
        <>
          <section className="flex flex-col gap-3 rounded-card border border-border bg-card p-5 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-muted-foreground">{t("identity.realName")}</dt>
              <dd className="min-w-0 break-words text-foreground">{own.realName}</dd>
              <dt className="text-muted-foreground">{t("identity.department")}</dt>
              <dd className="min-w-0 break-words text-foreground">{own.department}</dd>
            </dl>
            <p className="text-xs text-muted-foreground">{t("identity.source.google")}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">{t("identity.readOnly.note")}</p>
            <p className="text-xs text-muted-foreground">{t("identity.privateNote")}</p>
          </section>
          <section className="flex flex-col gap-2 rounded-card border border-border bg-card p-5 text-sm">
            <h2 className="font-semibold text-foreground">{t("identity.correction.title")}</h2>
            <p className="text-xs leading-relaxed text-muted-foreground">{t("identity.correction.description")}</p>
            <CorrectionRequestForm />
          </section>
        </>
      ) : !own && hints === undefined ? (
        // 3. a session from before the Google hints
        <section className="flex flex-col gap-3 rounded-card border border-border bg-card p-5 text-sm">
          <p className="text-muted-foreground">{t("identity.relogin.description")}</p>
          <form action={reloginForIdentityAction}>
            <Button type="submit" className="w-full sm:w-auto">
              {t("identity.relogin.button")}
            </Button>
          </form>
        </section>
      ) : (
        // 4. the exception path: this account's Google name gives no 실명·소속
        <>
          <p className="rounded-card border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            {t("identity.manual.description")}
          </p>
          <IdentityForm
            initial={own ? { realName: own.realName, department: own.department } : hints?.name ? { realName: hints.name, department: "" } : null}
            prefilled={{ realName: !own && Boolean(hints?.name), department: false }}
            consentGiven
            callbackUrl={callbackUrl}
            onboarding={onboarding}
          />
        </>
      )}

      {/* 동의 철회 -- whenever the consent is on file. */}
      {consented && (
        <details className="group rounded-card border border-border bg-card p-5 text-sm">
          <summary className="cursor-pointer list-none font-medium text-muted-foreground hover:text-foreground">
            {t("identity.withdraw.title")}
          </summary>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t("identity.withdraw.description")}</p>
          <form action={withdrawIdentityConsentAction} className="mt-3">
            <Button type="submit" variant="secondary" size="sm">
              {t("identity.withdraw.button")}
            </Button>
          </form>
        </details>
      )}
    </div>
  );
}
