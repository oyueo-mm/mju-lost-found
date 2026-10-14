
import { auth } from "@/lib/auth/auth";
import { requireReadyUser, sanitizeCallbackUrl } from "@/lib/auth/session";
import { getOwnIdentityInfo } from "@/lib/identity/service";
import { getTranslator } from "@/lib/i18n/server";
import { Button } from "@/components/ui/Button";
import { reloginForIdentityAction } from "./actions";
import { CorrectionRequestForm } from "./CorrectionRequestForm";
import { IdentityForm } from "./IdentityForm";

// 이름·소속. Collection is automatic: 이름·소속 are required items of the
// 개인정보 동의 (requireReadyUser sends anyone without it to the consent
// screen), stored right after it from the Google display name, and kept in
// sync at sign-in. This page only shows where a member stands (only the
// signed-in member's own values are ever loaded):
//
// 1. Values collected from Google -> read-only, with how they are kept in
//    sync and a 정정 요청 form. Never presented as school-verified.
// 2. No values, and a session from before the Google hints -> sign in again
//    (hints come only with a sign-in).
// 3. No values, and this account's Google name can't give them (not a school
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
  const fromGoogle = own?.realNameSource === "google_display_name";
  const hints = session?.identityHints;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-foreground">{t("identity.formTitle")}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{t("identity.formIntro")}</p>
      </div>

      {callbackUrl && !own && (
        <p className="rounded-card bg-primary-muted px-4 py-2.5 text-sm text-primary">{t("identity.redirectNotice")}</p>
      )}

      {own && fromGoogle ? (
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
            callbackUrl={callbackUrl}
            onboarding={onboarding}
          />
        </>
      )}

    </div>
  );
}
