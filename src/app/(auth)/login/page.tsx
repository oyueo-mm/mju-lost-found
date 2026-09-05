import Link from "next/link";
import { redirect } from "next/navigation";

import { signIn } from "@/lib/auth/auth";
import { getCurrentUser, sanitizeCallbackUrl, type LoginReason } from "@/lib/auth/session";

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: "명지대학교 계정(@mju.ac.kr)만 이용할 수 있습니다.",
  Default: "로그인 중 문제가 발생했습니다. 다시 시도해주세요.",
};

// Phase 14: the one-line explanation shown above the Google button when a
// protected page redirected here with a `reason` (see
// src/lib/auth/session.ts's requireReadyUser()). Purely informational --
// login itself doesn't change based on this.
const REASON_MESSAGES: Record<LoginReason, string> = {
  write: "게시글을 작성하거나 수정하려면 로그인해주세요.",
  chat: "채팅을 이용하려면 로그인해주세요.",
  match: "매칭 정보를 보려면 로그인해주세요.",
  mypost: "내 게시물을 보려면 로그인해주세요.",
  notification: "알림을 확인하려면 로그인해주세요.",
};

function isLoginReason(value: string): value is LoginReason {
  return value in REASON_MESSAGES;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reason?: string; callbackUrl?: string }>;
}) {
  const { error, reason, callbackUrl: rawCallbackUrl } = await searchParams;
  const callbackUrl = sanitizeCallbackUrl(rawCallbackUrl);

  const user = await getCurrentUser();
  if (user) {
    redirect(user.nickname ? (callbackUrl ?? "/") : "/onboarding");
  }

  const errorMessage = error ? ERROR_MESSAGES[error] ?? ERROR_MESSAGES.Default : null;
  const reasonMessage = reason && isLoginReason(reason) ? REASON_MESSAGES[reason] : null;

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-8 bg-zinc-50 px-6 dark:bg-black">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          명지 스마트 분실물 센터
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          @mju.ac.kr 계정으로 로그인하세요.
        </p>
      </div>

      {errorMessage && (
        <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {errorMessage}
        </p>
      )}

      {/* Phase 14: shown instead of the error box above when this page was
          reached by requireReadyUser()'s redirect (not by an actual OAuth
          error) -- a neutral explanation, not a red error message, since
          "please log in to do X" isn't a failure. */}
      {!errorMessage && reasonMessage && (
        <p className="rounded-md bg-zinc-100 px-4 py-2 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {reasonMessage}
        </p>
      )}

      <form
        action={async () => {
          "use server";
          // callbackUrl was already validated as same-origin-relative by
          // sanitizeCallbackUrl() above -- signIn's redirectTo accepts it
          // as-is, sending the user back to the page they came from
          // instead of always landing on "/".
          await signIn("google", callbackUrl ? { redirectTo: callbackUrl } : undefined);
        }}
      >
        <button
          type="submit"
          className="flex items-center gap-2 rounded-full border border-zinc-300 px-5 py-3 text-sm font-medium text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600"
        >
          Google로 로그인
        </button>
      </form>

      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        학교 계정(@mju.ac.kr)이 아닌 계정은 로그인할 수 없습니다.
      </p>

      <div className="flex flex-col items-center gap-1 border-t border-zinc-200 pt-6 text-center dark:border-zinc-800">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">명지대 계정이 없으신가요?</p>
        <Link
          href="/account-guide"
          className="text-sm font-medium text-zinc-700 underline hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50"
        >
          명지대 계정 생성 방법 보기
        </Link>
      </div>
    </div>
  );
}
