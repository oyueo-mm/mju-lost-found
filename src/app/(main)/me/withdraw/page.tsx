import { requireReadyUser } from "@/lib/auth/session";
import { AlertIcon } from "@/components/icons";
import { LinkButton } from "@/components/ui/Button";
import { WithdrawButton } from "./WithdrawButton";

// Phase 10: what's listed below is exactly what auth/user.ts's
// withdrawUser() actually does -- nothing here promises more (or less)
// than the real implementation. No fabricated legal process, no
// forced-scroll gate (this phase's own spec rules that out, same
// principle as P-8's consent screen) -- just a clear list, a checkbox,
// and a destructive-styled confirm button, reusing the site's existing
// design system throughout (Card/Button/icons, no new colors).
export default async function WithdrawPage() {
  // Same gate /me itself uses -- consent + nickname aren't actually
  // required to withdraw, but there's no reason to build a second path
  // for a user who hasn't finished onboarding; requireReadyUser already
  // routes them through /privacy-consent or /onboarding first, same as
  // visiting /me directly would.
  await requireReadyUser("mypost", "/me/withdraw");

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium tracking-wide text-muted-foreground">내 정보</p>
        <h1 className="text-xl font-semibold text-foreground">회원 탈퇴</h1>
      </div>

      <div className="flex flex-col gap-4 rounded-card border border-border bg-card p-5 text-sm text-foreground">
        <div className="flex items-center gap-1.5 font-semibold">
          <AlertIcon className="size-4.5 text-destructive" />
          탈퇴 전 꼭 확인해주세요
        </div>

        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-muted-foreground">
          <li>탈퇴 즉시 이 계정으로는 다시 로그인할 수 없습니다.</li>
          <li>이메일, 이름, 닉네임 등 계정 정보는 삭제되며 복구할 수 없습니다.</li>
          <li>
            작성하신 게시글·댓글·채팅 메시지는 삭제되지 않고 그대로 남으며, 작성자는{" "}
            <span className="font-medium text-foreground">&quot;탈퇴한 사용자&quot;</span>로 표시됩니다.
          </li>
          <li>알림은 함께 삭제됩니다.</li>
          <li>이 작업은 되돌릴 수 없습니다.</li>
        </ul>
      </div>

      <WithdrawButton />

      <LinkButton href="/me" variant="secondary" className="w-full">
        취소하고 돌아가기
      </LinkButton>
    </div>
  );
}
