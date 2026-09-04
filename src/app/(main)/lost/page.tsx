import { SearchFilterBar } from "@/components/search/SearchFilterBar";

export default function LostListPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">분실물 게시판</h1>
      <SearchFilterBar />
      <div className="rounded-lg border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        등록된 분실물 게시글이 없습니다. (추후 실제 데이터 연동 예정)
      </div>
    </div>
  );
}
