"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/i18n/client";
import Icon from "./Icon";

export default function BottomNav({ show, staff, chatUnread, pendingReports }) {
  const pathname = usePathname();
  const t = useT();

  if (!show) return null;
  if (/^\/chat\/\d+/.test(pathname)) return null;
  if (/\/(lost|found)\/new/.test(pathname)) return null;

  const items = [
    { href: "/", label: t("nav.board"), icon: "home" },
    { href: "/search", label: t("nav.search"), icon: "search" },
    { href: "/chat", label: t("nav.chat"), icon: "chat", badge: chatUnread },
    { href: "/my", label: t("nav.my"), icon: "user" },
    ...(staff
      ? [
          {
            href: "/admin",
            label: t("nav.admin"),
            icon: "shield",
            badge: pendingReports,
          },
        ]
      : []),
  ];

  const isActive = (href) =>
    href === "/"
      ? pathname === "/" || /^\/(lost|found)/.test(pathname)
      : pathname.startsWith(href);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur-md sm:hidden">
      <div className="mx-auto flex max-w-3xl px-2 pb-[env(safe-area-inset-bottom)]">
        {items.map((it) => {
          const active = isActive(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`relative flex flex-1 flex-col items-center gap-1 pb-2.5 pt-3 text-[10px] font-semibold tracking-tight transition active:scale-95 ${
                active ? "text-brand" : "text-ink-faint"
              }`}
            >
              <span
                aria-hidden
                className={`absolute top-0 h-0.5 w-8 rounded-full bg-brand transition-opacity ${
                  active ? "opacity-100" : "opacity-0"
                }`}
              />
              <span className="relative">
                <Icon
                  name={it.icon}
                  size={21}
                  strokeWidth={active ? 2.1 : 1.8}
                />
                {it.badge > 0 && (
                  <span className="num absolute -right-2 -top-1 min-w-[15px] rounded-full bg-brand px-1 text-center text-[9px] font-bold leading-[15px] text-white">
                    {it.badge > 99 ? "99" : it.badge}
                  </span>
                )}
              </span>
              {it.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
