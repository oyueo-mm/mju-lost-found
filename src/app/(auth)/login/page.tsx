import { redirect } from "next/navigation";

import { signIn } from "@/lib/auth/auth";
import { getCurrentUser } from "@/lib/auth/session";

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: "명지대학교 계정(@mju.ac.kr)만 이용할 수 있습니다.",
  Default: "로그인 중 문제가 발생했습니다. 다시 시도해주세요.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) {
    redirect(user.nickname ? "/" : "/onboarding");
  }

  const { error } = await searchParams;
  const errorMessage = error ? ERROR_MESSAGES[error] ?? ERROR_MESSAGES.Default : null;

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

      <form
        action={async () => {
          "use server";
          await signIn("google");
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
    </div>
  );
}
