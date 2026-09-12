import Link from "next/link";
import Icon from "./Icon";

// 헤더 내비 항목. items 가 있으면 마우스를 올리기만 해도(또는 키보드 포커스) 드롭다운.
// JS 없이 CSS 만으로 동작 — 서버 컴포넌트에서 그대로 렌더.
// 데스크톱 전용(모바일은 BottomNav).

export function NavBadge({ n }) {
  if (!n) return null;
  return (
    <span className="ml-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold leading-4 text-white">
      {n > 99 ? "99+" : n}
    </span>
  );
}

export default function NavMenu({ href, label, badge = 0, items }) {
  const trigger = (
    <Link
      href={href}
      className="flex items-center gap-0.5 rounded-md px-2.5 py-1.5 transition hover:bg-sunken hover:text-ink group-hover:bg-sunken group-hover:text-ink"
    >
      {label}
      <NavBadge n={badge} />
      {items && (
        <Icon
          name="chevronDown"
          size={13}
          className="ml-0.5 text-ink-faint transition-transform duration-200 group-hover:rotate-180"
        />
      )}
    </Link>
  );

  if (!items?.length) return trigger;

  return (
    <div className="group relative">
      {trigger}

      {/* pt-2 = 트리거와 패널 사이 공간까지 hover 영역에 포함 (마우스 이동 중 닫힘 방지) */}
      <div className="invisible absolute left-0 top-full z-30 pt-2 opacity-0 transition-[opacity,visibility,transform] duration-150 ease-out group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 motion-safe:-translate-y-1">
        <div
          className="card min-w-[220px] overflow-hidden py-1.5"
          style={{ boxShadow: "var(--shadow-pop)" }}
        >
          {items.map((it, i) =>
            it === "divider" ? (
              <div key={`d${i}`} className="my-1.5 border-t border-line-soft" />
            ) : it.form ? (
              <form key={it.label} action={it.form} method="post">
                <button
                  type="submit"
                  className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] text-ink-soft transition hover:bg-sunken hover:text-ink"
                >
                  <Icon name={it.icon} size={15} className="shrink-0 text-ink-faint" />
                  {it.label}
                </button>
              </form>
            ) : (
              <Link
                key={it.href}
                href={it.href}
                className="flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-ink-soft transition hover:bg-sunken hover:text-ink"
              >
                <Icon name={it.icon} size={15} className="shrink-0 text-ink-faint" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink">{it.label}</span>
                  {it.desc && (
                    <span className="block text-[11px] leading-snug text-ink-faint">
                      {it.desc}
                    </span>
                  )}
                </span>
                <NavBadge n={it.badge} />
              </Link>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
