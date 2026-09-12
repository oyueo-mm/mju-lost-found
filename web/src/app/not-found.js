import Link from "next/link";
import Icon from "@/components/Icon";

export default function NotFound() {
  return (
    <main className="brand-wash flex min-h-dvh flex-col items-center justify-center gap-3 px-5 text-center">
      <Icon name="search" size={44} className="text-brand-soft" strokeWidth={1.6} />
      <h1 className="text-lg font-extrabold">페이지를 찾을 수 없어요</h1>
      <Link href="/" className="btn btn-primary mt-1 px-5 py-2.5">
        홈으로
      </Link>
    </main>
  );
}
