import { redirect } from "next/navigation";

import { requireReadyUser } from "@/lib/auth/session";
import { isCurrentlySuspended } from "@/lib/auth/suspension";

// Landing page for requireActiveUser()'s redirect (see src/lib/auth/session.ts).
// Not a Streamlit-parity page -- the legacy app never gates *viewing* on
// suspension (only specific write actions reject with SUSPENDED_ACCOUNT_MESSAGE,
// see ui/auth.py::is_suspended()'s docstring) -- this route exists only so a
// future Server Action that adopts requireActiveUser() as its gate has
// somewhere meaningful to send a suspended user, instead of failing with an
// unstyled error. If the user is no longer suspended (timed suspension
// expired, or never was), send them home instead of showing a stale notice.
export default async function SuspendedPage() {
  const user = await requireReadyUser(); // redirects to /login or /onboarding as needed

  if (!isCurrentlySuspended(user)) {
    redirect("/");
  }

  const untilText = user.suspendedUntil
    ? `${user.suspendedUntil.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}까지`
    : "영구";

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 bg-zinc-50 px-6 text-center dark:bg-black">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        현재 이용이 제한된 계정입니다
      </h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        관리자 조치로 계정이 정지되어 새 게시물 작성, 매칭, 채팅 등 일부 기능을 이용할 수 없습니다.
        <br />
        정지 기간: {untilText}
      </p>
    </div>
  );
}
