import Link from "next/link";
import { requireUser } from "@/lib/auth";
import Icon from "@/components/Icon";
import DeleteAccountForm from "@/components/DeleteAccountForm";

export const metadata = { title: "회원 탈퇴 · 명지 분실물 센터" };

export default async function DeleteAccountPage() {
  await requireUser();

  return (
    <div className="mx-auto max-w-md">
      <div className="flex items-center gap-2">
        <Link
          href="/my"
          className="grid h-8 w-8 place-items-center rounded-full text-ink-soft transition hover:bg-sunken"
        >
          <Icon name="back" size={17} />
        </Link>
        <h1 className="text-xl font-extrabold">회원 탈퇴</h1>
      </div>

      <p className="mt-3 text-sm text-ink-soft">
        떠나신다니 아쉬워요. 아래 내용을 확인하고 진행해 주세요.
      </p>

      <div className="mt-5">
        <DeleteAccountForm />
      </div>

      <Link
        href="/my"
        className="mt-3 block text-center text-sm text-ink-faint underline"
      >
        그냥 돌아가기
      </Link>
    </div>
  );
}
