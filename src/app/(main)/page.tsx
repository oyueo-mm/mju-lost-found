import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          명지 스마트 분실물 센터
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          캠퍼스에서 잃어버린 물건을 찾고, 주운 물건을 등록하세요.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/lost"
          className="rounded-lg border border-zinc-200 p-6 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
        >
          <h2 className="font-medium text-zinc-900 dark:text-zinc-50">분실물 찾기</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            등록된 분실물 게시글을 둘러봅니다.
          </p>
        </Link>
        <Link
          href="/found"
          className="rounded-lg border border-zinc-200 p-6 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
        >
          <h2 className="font-medium text-zinc-900 dark:text-zinc-50">습득물 등록/조회</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            주운 물건을 등록하거나 등록된 습득물을 확인합니다.
          </p>
        </Link>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium text-zinc-900 dark:text-zinc-50">최근 게시물</h2>
        <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          아직 표시할 게시물이 없습니다. (추후 실제 데이터 연동 예정)
        </div>
      </section>
    </div>
  );
}
