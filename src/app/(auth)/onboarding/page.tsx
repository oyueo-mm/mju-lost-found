import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { LogoMark } from "@/components/layout/Logo";
import { NicknameForm } from "./NicknameForm";
import { getTranslator } from "@/lib/i18n/server";

export default async function OnboardingPage() {
  const user = await requireUser(); // redirects to /login if not signed in
  const t = await getTranslator();

  // Phase 8: consent comes before nickname (see session.ts's
  // requireReadyUser for the same ordering) -- this page calls
  // requireUser() directly, not requireReadyUser(), specifically so it
  // can redirect a not-yet-consented visitor to /privacy-consent instead
  // of looping back to itself.
  if (user.privacyConsentAt === null) {
    redirect("/privacy-consent?callbackUrl=%2Fonboarding");
  }

  if (user.nickname !== null) {
    redirect("/");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-sm flex-col items-center gap-7">
        <div className="flex flex-col items-center gap-2 text-center">
          <LogoMark size={56} />
          <h1 className="mt-1 text-xl font-semibold text-foreground">
            {t("auth.onboarding.welcome", { name: user.name ?? "" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("auth.onboarding.description")}
            <br />
            {t("auth.onboarding.hint")}
          </p>
        </div>
        <NicknameForm />
      </div>
    </div>
  );
}
