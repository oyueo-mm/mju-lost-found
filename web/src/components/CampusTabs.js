"use client";

import { useRouter } from "next/navigation";
import { CAMPUSES } from "@/lib/campus";
import { useT } from "@/i18n/client";

// 게시판 상단 캠퍼스 전환 탭. 선택을 쿠키에 저장해 다음 방문 때 유지.
// basePath: 캠퍼스 변경 시 이동할 경로 (다른 쿼리 유지). 기본 "/".
export default function CampusTabs({ current, basePath = "/" }) {
  const router = useRouter();
  const t = useT();

  function go(key) {
    if (key === current) return;
    document.cookie = `campus=${key}; path=/; max-age=${60 * 60 * 24 * 180}`;
    const sep = basePath.includes("?") ? "&" : "?";
    router.push(`${basePath}${sep}campus=${key}`);
    router.refresh();
  }

  return (
    <div className="flex gap-1 rounded-lg bg-sunken p-1">
      {Object.values(CAMPUSES).map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => go(c.key)}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-semibold transition ${
            current === c.key
              ? "bg-surface text-ink shadow-sm"
              : "text-ink-soft hover:text-ink"
          }`}
        >
          {t(`campus.${c.key}`)}
        </button>
      ))}
    </div>
  );
}
