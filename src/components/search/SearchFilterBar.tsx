export function SearchFilterBar() {
  return (
    <div className="flex flex-wrap gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <input
        type="text"
        placeholder="검색어를 입력하세요"
        disabled
        className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-transparent"
      />
      <select
        disabled
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-transparent"
      >
        <option>카테고리</option>
      </select>
      <select
        disabled
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-transparent"
      >
        <option>위치</option>
      </select>
    </div>
  );
}
