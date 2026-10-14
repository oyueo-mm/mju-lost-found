import { auth } from "@/lib/auth/auth";
import { requireReadyUser, sanitizeCallbackUrl } from "@/lib/auth/session";
import { CURRENT_IDENTITY_CONSENT_VERSION } from "@/lib/auth/terms";
import { getOwnIdentityInfo } from "@/lib/identity/service";
import { getTranslator } from "@/lib/i18n/server";
import { IdentityForm } from "./IdentityForm";

// 실명·학과 등록·수정. Reached three ways: right after a new member sets
// their nickname (?onboarding=1, with a "나중에 할게요" way out), from 내
// 정보, or when posting/chatting needs it (?callbackUrl= -- back there
// after saving). Only the signed-in member's own values are ever loaded.
//
// 실명·학과 자동 입력: with nothing saved yet, the form starts from the
// member's own Google suggestions (session identityHints -- the Google
// account name, and a Google profile department only if that scope is on),
// each flagged as a suggestion to check. Saved values always win.
export default async function IdentityPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; onboarding?: string }>;
}) {
  const user = await requireReadyUser("mypost", "/me/identity");
  const [t, own, params, session] = await Promise.all([getTranslator(), getOwnIdentityInfo(user.id), searchParams, auth()]);
  const hints = own ? null : (session?.identityHints ?? null);
  const callbackUrl = sanitizeCallbackUrl(params.callbackUrl) ?? null;
  const onboarding = params.onboarding === "1";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-foreground">{t("identity.formTitle")}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{t("identity.formIntro")}</p>
      </div>

      {callbackUrl && !onboarding && (
        <p className="rounded-card bg-primary-muted px-4 py-2.5 text-sm text-primary">{t("identity.redirectNotice")}</p>
      )}

      <IdentityForm
        initial={
          own
            ? { realName: own.realName, department: own.department }
            : hints?.name || hints?.department
              ? { realName: hints.name ?? "", department: hints.department ?? "" }
              : null
        }
        prefilled={{ realName: Boolean(hints?.name), department: Boolean(hints?.department) }}
        consentGiven={own?.consentVersion === CURRENT_IDENTITY_CONSENT_VERSION}
        callbackUrl={callbackUrl}
        onboarding={onboarding}
      />
    </div>
  );
}
