"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { CAMPUSES } from "@/lib/campus";
import Icon from "./Icon";
import ImageSearchPanel from "./ImageSearchPanel";

const sel =
  "min-w-0 rounded-lg border border-line bg-surface px-2.5 py-2 outline-none focus:border-brand focus:shadow-[0_0_0_3px_var(--color-brand-tint)]";

export default function SearchForm() {
  const router = useRouter();
  const sp = useSearchParams();
  // 헤더 메뉴 "사진으로 찾기" → /search?mode=image 로 바로 열림
  const [imageMode, setImageMode] = useState(sp.get("mode") === "image");

  function submit(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    for (const k of ["q", "campus", "board"]) {
      const v = f.get(k);
      if (v) params.set(k, v.toString());
    }
    router.push(`/search?${params.toString()}`);
  }

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="card space-y-2.5 p-4">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 focus-within:border-brand focus-within:shadow-[0_0_0_3px_var(--color-brand-tint)]">
          <Icon name="search" size={17} className="shrink-0 text-ink-faint" />
          <input
            name="q"
            type="text"
            defaultValue={sp.get("q") || ""}
            autoFocus
            autoComplete="off"
            spellCheck="false"
            placeholder="물건 이름이나 특징으로 검색"
            className="min-w-0 flex-1 bg-transparent py-2.5 outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            name="campus"
            defaultValue={sp.get("campus") || ""}
            className={`${sel} min-w-0`}
          >
            <option value="">전체 캠퍼스</option>
            {Object.values(CAMPUSES).map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            name="board"
            defaultValue={sp.get("board") || "found"}
            className={`${sel} min-w-0`}
          >
            <option value="found">습득</option>
            <option value="lost">분실</option>
            <option value="all">전체</option>
          </select>
          <button
            type="submit"
            className="btn btn-primary ml-auto shrink-0 px-5 py-2 text-sm"
          >
            검색
          </button>
        </div>

        <button
          type="button"
          onClick={() => setImageMode((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-semibold text-brand-strong"
        >
          <Icon name="camera" size={15} />
          {imageMode ? "사진 검색 닫기" : "사진으로 찾기"}
        </button>
      </form>

      {imageMode && <ImageSearchPanel />}
    </div>
  );
}
