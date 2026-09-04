"use client";

import { useRouter, useSearchParams } from "next/navigation";

import type { PostListType, SortOption } from "@/lib/posts/schema";

type SearchFilterBarProps = {
  basePath: string; // where the form navigates to on submit, e.g. "/lost", "/search"
  showTypeFilter?: boolean; // the 게시판 selector only makes sense on /search
};

const TYPE_OPTIONS: { value: PostListType; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "lost", label: "분실물" },
  { value: "found", label: "습득물" },
];

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "latest", label: "최신순" },
  { value: "oldest", label: "오래된순" },
];

export function SearchFilterBar({ basePath, showTypeFilter = false }: SearchFilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const hasActiveFilters = ["q", "category", "location", "sort"].some((key) => searchParams.get(key));

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const params = new URLSearchParams();

    for (const key of ["q", "type", "category", "location", "sort"]) {
      const value = formData.get(key);
      if (typeof value === "string" && value.trim() !== "") {
        params.set(key, value.trim());
      }
    }
    // A new search always starts from page 1 -- keeping the old page
    // number here could point past the end of the new result set.

    const query = params.toString();
    router.push(query ? `${basePath}?${query}` : basePath);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <input
        name="q"
        type="text"
        placeholder="검색어를 입력하세요"
        defaultValue={searchParams.get("q") ?? ""}
        maxLength={100}
        className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-transparent"
      />

      <div className="flex flex-wrap gap-3">
        {showTypeFilter && (
          <select
            name="type"
            defaultValue={searchParams.get("type") ?? "all"}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-transparent"
          >
            {TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}

        <input
          name="category"
          type="text"
          placeholder="카테고리"
          defaultValue={searchParams.get("category") ?? ""}
          maxLength={100}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-transparent"
        />

        <input
          name="location"
          type="text"
          placeholder="위치"
          defaultValue={searchParams.get("location") ?? ""}
          maxLength={200}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-transparent"
        />

        <select
          name="sort"
          defaultValue={searchParams.get("sort") ?? "latest"}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-transparent"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <button
          type="submit"
          className="ml-auto rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
        >
          검색
        </button>
      </div>

      {hasActiveFilters && (
        <button
          type="button"
          onClick={() => router.push(basePath)}
          className="self-start text-xs text-zinc-500 underline dark:text-zinc-400"
        >
          필터 초기화
        </button>
      )}
    </form>
  );
}
