import { redirect } from "next/navigation";
import { getSessionUser, isEmailPermitted } from "@/lib/auth";
import { majorFromName } from "@/lib/profile";
import NicknameForm from "./NicknameForm";
import LogoMark from "@/components/LogoMark";

export default async function OnboardingPage() {
  const session = await getSessionUser();
  if (!session) redirect("/login");
  if (!(await isEmailPermitted(session.user.email)))
    redirect("/login?error=domain");
  if (session.profile?.nickname) redirect("/");

  const detectedMajor = majorFromName(
    session.user.user_metadata?.full_name ||
      session.user.user_metadata?.name ||
      session.profile?.name,
  );

  return (
    <main className="brand-wash flex min-h-dvh items-center justify-center px-5">
      <div className="card w-full max-w-sm p-8">
        <LogoMark size={48} rounded="rounded-xl" />
        <h1 className="mt-4 text-lg font-extrabold">프로필 설정</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
          닉네임은 다른 사용자에게 보여지고, 한 번 정하면 바꿀 수 없어요. 학과는
          명지대 계정에서 자동으로 가져와요.
        </p>
        <NicknameForm detectedMajor={detectedMajor} />
      </div>
    </main>
  );
}
