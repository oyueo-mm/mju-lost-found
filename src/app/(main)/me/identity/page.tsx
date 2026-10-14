import { requireReadyUser, sanitizeCallbackUrl } from "@/lib/auth/session";
import { CURRENT_IDENTITY_CONSENT_VERSION } from "@/lib/auth/terms";
import { getOwnIdentityInfo } from "@/lib/identity/service";
import { getTranslator } from "@/lib/i18n/server";
import { IdentityForm } from "./IdentityForm";

// 실명·학과 등록·수정. Reached three ways: right after a new member sets
// their nickname (?onboarding=1, with a "나중에 할게요" way out), from 내
// 정보, or when posting/chatting needs it (?callbackUrl= -- back there
// after saving). Only the signed-in member's own values are ever loaded.
export default async function IdentityPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; onboarding?: string }>;
}) {
  const user = await requireReadyUser("mypost", "/me/identity");
  const [t, own, params] = await Promise.all([getTranslator(), getOwnIdentityInfo(user.id), searchParams]);
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
        initial={own ? { realName: own.realName, department: own.department } : null}
        consentGiven={own?.consentVersion === CURRENT_IDENTITY_CONSENT_VERSION}
        callbackUrl={callbackUrl}
        onboarding={onboarding}
      />
    </div>
  );
}
