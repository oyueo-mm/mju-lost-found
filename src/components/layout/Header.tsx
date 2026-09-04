import Link from "next/link";

const NAV_LINKS = [
  { href: "/", label: "홈" },
  { href: "/lost", label: "분실물" },
  { href: "/found", label: "습득물" },
] as const;

export function Header() {
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
        <Link href="/" className="font-semibold text-zinc-900 dark:text-zinc-50">
          명지 스마트 분실물 센터
        </Link>
        <nav className="flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-zinc-900 dark:hover:text-zinc-50">
              {link.label}
            </Link>
          ))}
          <Link
            href="/login"
            className="rounded-full border border-zinc-300 px-3 py-1 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600"
          >
            로그인
          </Link>
        </nav>
      </div>
    </header>
  );
}
