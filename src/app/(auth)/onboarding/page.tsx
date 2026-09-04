import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { NicknameForm } from "./NicknameForm";

export default async function OnboardingPage() {
  const user = await requireUser(); // redirects to /login if not signed in

  if (user.nickname !== null) {
    redirect("/");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 bg-zinc-50 px-6 dark:bg-black">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          환영합니다, {user.name}님
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          서비스를 이용하려면 먼저 고정 닉네임을 설정해주세요.
          <br />
          닉네임은 한 번 설정하면 변경할 수 없습니다.
        </p>
      </div>
      <NicknameForm />
    </div>
  );
}
