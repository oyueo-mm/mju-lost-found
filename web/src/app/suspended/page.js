import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser, isSuspended } from "@/lib/auth";
import { SUPPORT_EMAIL } from "@/lib/legal";
import { formatDateTime } from "@/lib/format";
import SuspensionCountdown from "@/components/SuspensionCountdown";
import AppealForm from "@/components/AppealForm";

export const metadata = { title: "계정 정지 · 명지 분실물 센터" };

export default async function SuspendedPage() {
  const session = await getSessionUser();
  if (!session) redirect("/login");
  if (!isSuspended(session.profile)) redirect("/");

  const { suspended_until: until, suspension_reason: reason } = session.profile;
  const appealText = session.profile.appeal_text || null;
  const appealAt = session.profile.appeal_at || null;
  const supportEmail = SUPPORT_EMAIL;

  return (
    <main className="brand-wash flex min-h-dvh flex-col items-center justify-center px-5 py-10">
      <div className="card w-full max-w-sm p-8 text-center">
        <p className="text-2xl font-extrabold">계정이 정지되었어요</p>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          커뮤니티 규정 위반으로 서비스 이용이 제한된 상태예요. 글쓰기·채팅은
          물론 게시판 열람도 할 수 없어요.
        </p>

        {reason && (
          <div className="mt-4 rounded-lg border border-line bg-sunken px-4 py-3 text-left">
            <p className="text-[11px] font-semibold text-ink-faint">정지 사유</p>
            <p className="mt-0.5 text-sm font-semibold">{reason}</p>
          </div>
        )}

        {until ? (
          <SuspensionCountdown until={until} />
        ) : (
          <div className="mt-4 rounded-lg bg-brand-tint px-4 py-3 text-sm font-bold text-brand-deep">
            영구 정지
          </div>
        )}

        {until && (
          <p className="num mt-2 text-xs text-ink-faint">
            {formatDateTime(until)} 해제 예정
          </p>
        )}

        <AppealForm
          existingText={appealText}
          existingAt={appealAt}
          supportEmail={supportEmail}
        />

        <form action="/auth/signout" method="post" className="mt-5">
          <button
            type="submit"
            className="btn btn-ghost w-full py-2.5 text-sm text-ink-soft"
          >
            로그아웃
          </button>
        </form>
        <Link
          href="/privacy"
          className="mt-2 block text-xs text-ink-faint underline"
        >
          개인정보 처리방침
        </Link>
      </div>
    </main>
  );
}
