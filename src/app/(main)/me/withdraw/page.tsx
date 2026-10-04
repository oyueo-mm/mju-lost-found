import { requireReadyUser } from "@/lib/auth/session";
import { AccountExitOptions } from "@/components/account/AccountExitOptions";
import { LinkButton } from "@/components/ui/Button";

// Phase 비활성화 + 회원탈퇴: both ways to leave, with the difference spelled
// out (see AccountExitOptions -- every line there matches what the code
// actually does). No forced-scroll gate (same principle as P-8's consent
// screen) -- a clear list, a checkbox and a destructive-styled button each.
export default async function WithdrawPage() {
  // Same gate /me itself uses -- consent + nickname aren't actually
  // required to leave, but there's no reason to build a second path for a
  // user who hasn't finished onboarding; requireReadyUser already routes
  // them through /privacy-consent or /onboarding first, same as visiting
  // /me directly would.
  await requireReadyUser("mypost", "/me/withdraw");

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium tracking-wide text-muted-foreground">내 정보</p>
        <h1 className="text-xl font-semibold text-foreground">계정 비활성화 · 회원탈퇴</h1>
        <p className="text-sm text-muted-foreground">
          개인정보 수집·이용 동의 철회도 여기에서 할 수 있어요. 필수 동의를 철회하면 서비스를 이용할 수 없으므로
          회원탈퇴로 처리됩니다.
        </p>
      </div>

      <AccountExitOptions />

      <LinkButton href="/me" variant="secondary" className="w-full">
        취소하고 돌아가기
      </LinkButton>
    </div>
  );
}
