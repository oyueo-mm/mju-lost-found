export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="flex flex-col gap-6">
      <div className="aspect-video w-full rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700" />

      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          게시물 제목 (id: {id})
        </h1>
        <div className="flex flex-wrap gap-2 text-sm text-zinc-500 dark:text-zinc-400">
          <span>카테고리: -</span>
          <span>위치: -</span>
        </div>
      </div>

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        게시물 설명이 여기에 표시됩니다. (추후 실제 데이터 연동 예정)
      </p>

      <div className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        작성자 정보 영역 (닉네임 등)
      </div>
    </div>
  );
}
