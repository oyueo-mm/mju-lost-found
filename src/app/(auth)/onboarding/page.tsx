import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { LogoMark } from "@/components/layout/Logo";
import { NicknameForm } from "./NicknameForm";

export default async function OnboardingPage() {
  const user = await requireUser(); // redirects to /login if not signed in

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
          <h1 className="mt-1 text-xl font-semibold text-foreground">환영합니다, {user.name}님</h1>
          <p className="text-sm text-muted-foreground">
            서비스를 이용하려면 먼저 닉네임을 설정해주세요.
            <br />
            닉네임은 나중에 내 정보에서 언제든 변경할 수 있습니다.
          </p>
        </div>
        <NicknameForm />
      </div>
    </div>
  );
}
