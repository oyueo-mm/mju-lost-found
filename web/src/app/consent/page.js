import { redirect } from "next/navigation";
import { getSessionUser, isEmailPermitted, isSuspended } from "@/lib/auth";
import { hasAgreedToTerms } from "@/lib/legal";
import LogoMark from "@/components/LogoMark";
import ConsentForm from "@/components/ConsentForm";

export const metadata = { title: "약관 동의 · 명지 분실물 센터" };

export default async function ConsentPage() {
  const session = await getSessionUser();
  if (!session) redirect("/login");
  if (!(await isEmailPermitted(session.user.email)))
    redirect("/login?error=domain");
  if (!session.profile?.nickname) redirect("/onboarding");
  if (isSuspended(session.profile)) redirect("/suspended");
  if (hasAgreedToTerms(session.profile)) redirect("/");

  const renewal = Boolean(session.profile?.terms_agreed_at);

  return (
    <main className="brand-wash flex min-h-dvh flex-col items-center justify-center px-5 py-10">
      <div className="card w-full max-w-md p-8">
        <LogoMark size={44} rounded="rounded-xl" />
        <h1 className="mt-4 text-lg font-extrabold">
          {renewal ? "약관이 개정되었어요" : "서비스 이용 약관 동의"}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
          {renewal
            ? "변경된 약관과 개인정보 처리방침에 다시 동의해 주세요."
            : "명지 스마트 분실물 센터를 이용하려면 아래 항목에 동의해야 해요. 이 서비스는 학생이 만든 비영리 프로젝트예요."}
        </p>

        <ConsentForm />

        <form action="/auth/signout" method="post" className="mt-3">
          <button
            type="submit"
            className="w-full py-2 text-center text-xs text-ink-faint underline"
          >
            동의하지 않고 로그아웃
          </button>
        </form>
      </div>
    </main>
  );
}
