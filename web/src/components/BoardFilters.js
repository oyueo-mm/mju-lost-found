"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useRef } from "react";
import { CATEGORIES } from "@/lib/constants";
import { useT } from "@/i18n/client";
import Icon from "./Icon";

// 게시판 필터 — 키워드 · 카테고리 · 정렬. 값은 URL 쿼리에 담겨서 새로고침·공유해도 유지.
// 셀렉트는 바꾸는 즉시 적용, 키워드는 Enter / 검색 버튼.
export default function BoardFilters({ q = "", category = "", sort = "newest" }) {
  const router = useRouter();
  const sp = useSearchParams();
  const inputRef = useRef(null);
  const t = useT();

  function apply(patch) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    router.push(qs ? `/?${qs}` : "/");
  }

  function submit(e) {
    e.preventDefault();
    apply({ q: inputRef.current?.value.trim() || "" });
  }

  const hasFilter = q || category || sort !== "newest";

  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={submit} className="flex items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 focus-within:border-brand">
          <Icon name="search" size={15} className="shrink-0 text-ink-faint" />
          <input
            ref={inputRef}
            type="search"
            name="q"
            defaultValue={q}
            placeholder={t("filter.placeholder")}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint"
          />
        </label>
        <button type="submit" className="btn btn-ghost px-3 py-2 text-sm">
          {t("common.search")}
        </button>
      </form>

      {/* 카테고리 바로가기 — 가로 스크롤 칩. 누르면 즉시 필터 */}
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden">
        {["", ...CATEGORIES].map((c) => {
          const active = category === c;
          return (
            <button
              key={c || "all"}
              type="button"
              onClick={() => apply({ category: c })}
              aria-pressed={active}
              className={`shrink-0 rounded-full border px-3 py-1 text-[13px] font-semibold transition ${
                active
                  ? "border-brand bg-brand text-white"
                  : "border-line bg-surface text-ink-soft hover:border-brand-soft hover:text-ink"
              }`}
            >
              {c ? t(`cat.${c}`) : t("common.all")}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <select
          value={sort}
          onChange={(e) => apply({ sort: e.target.value === "newest" ? "" : e.target.value })}
          aria-label="sort"
          className="rounded-lg border border-line bg-surface px-2.5 py-2 text-sm outline-none focus:border-brand"
        >
          <option value="newest">{t("filter.newest")}</option>
          <option value="oldest">{t("filter.oldest")}</option>
        </select>
        {hasFilter && (
          <button
            type="button"
            onClick={() => {
              if (inputRef.current) inputRef.current.value = "";
              apply({ q: "", category: "", sort: "" });
            }}
            className="btn btn-ghost shrink-0 gap-1 px-2.5 py-2 text-xs"
            aria-label={t("common.reset")}
          >
            <Icon name="x" size={13} />
            {t("common.reset")}
          </button>
        )}
      </div>
    </div>
  );
}
