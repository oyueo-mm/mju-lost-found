import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { search } from "@/lib/search";
import SearchForm from "@/components/SearchForm";
import PostCard from "@/components/PostCard";
import StatusBadge from "@/components/StatusBadge";

export const metadata = { title: "검색 · 명지 분실물 센터" };

export default async function SearchPage({ searchParams }) {
  await requireUser();
  const sp = await searchParams;
  const q = (sp.q || "").trim();

  let results = [];
  if (q) {
    const supabase = await createClient();
    results = await search(supabase, {
      q,
      board: sp.board || "found",
      campus: sp.campus || "",
    });
  }

  return (
    <div>
      <h1 className="text-xl font-extrabold">검색</h1>

      <div className="mt-4">
        <SearchForm />
      </div>

      <div className="mt-4">
        {!q ? (
          <p className="card-dashed p-10 text-center text-sm text-ink-faint">
            찾는 물건을 검색해 보세요.
          </p>
        ) : results.length === 0 ? (
          <p className="card-dashed p-10 text-center text-sm text-ink-faint">
            “{q}” 검색 결과가 없어요.
          </p>
        ) : (
          <>
            <p className="num mb-2 text-[13px] text-ink-faint">
              검색 결과 {results.length}건
            </p>
            <div className="card divide-y divide-line-soft overflow-hidden">
              {results.map(({ kind, post, pct }) => (
                <PostCard
                  key={`${kind}-${post.id}`}
                  post={post}
                  kind={kind}
                  badge={
                    typeof pct === "number" && pct > 0 ? (
                      <span className="num chip shrink-0 bg-brand text-white">
                        {pct}%
                      </span>
                    ) : (
                      <StatusBadge status={post.status} />
                    )
                  }
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
