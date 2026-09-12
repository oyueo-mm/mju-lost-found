"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/i18n/client";
import LanguageSwitcher from "./LanguageSwitcher";

export default function Footer() {
  const pathname = usePathname();
  const t = useT();
  // 전체화면 채팅방 / 알림 목록에선 숨김
  if (/^\/chat\/\d+/.test(pathname) || pathname === "/notifications") {
    return null;
  }

  return (
    <footer className="mt-10 border-t border-line-soft pt-6 text-sm text-ink-faint">
      <p className="font-bold text-ink-soft">{t("app.name")}</p>
      <p className="mt-1 text-xs">{t("footer.tagline")}</p>

      <nav className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        <Link href="/notices" className="hover:text-ink">
          {t("footer.notices")}
        </Link>
        <Link href="/help" className="hover:text-ink">
          {t("footer.help")}
        </Link>
        <Link href="/help#guide" className="hover:text-ink">
          {t("footer.guide")}
        </Link>
        <Link href="/credits" className="hover:text-ink">
          {t("footer.credits")}
        </Link>
        <Link href="/terms" className="hover:text-ink">
          {t("footer.terms")}
        </Link>
        <Link href="/privacy" className="hover:text-ink">
          {t("footer.privacy")}
        </Link>
        <a
          href="https://www.mju.ac.kr"
          target="_blank"
          rel="noreferrer"
          className="hover:text-ink"
        >
          {t("footer.mju")}
        </a>
      </nav>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-xs font-semibold text-ink-soft">{t("footer.language")}</span>
        <LanguageSwitcher />
      </div>

      <p className="mt-4 text-xs leading-relaxed">{t("footer.disclaimer")}</p>
      <p className="mt-2 text-xs">
        © {new Date().getFullYear()} {t("app.name")} · Beta
      </p>
    </footer>
  );
}
