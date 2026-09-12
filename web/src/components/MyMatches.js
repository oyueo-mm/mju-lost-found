import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import CancelMatchButton from "./CancelMatchButton";
import CompleteMatchButton from "./CompleteMatchButton";

export default async function MyMatches({ userId }) {
  const supabase = await createClient();

  const [{ data: myLost }, { data: myFound }] = await Promise.all([
    supabase.from("lost_posts").select("id").eq("user_id", userId),
    supabase.from("found_posts").select("id").eq("user_id", userId),
  ]);
  const lostIds = (myLost || []).map((p) => p.id);
  const foundIds = (myFound || []).map((p) => p.id);

  const empty = (
    <p className="card-dashed p-6 text-center text-sm text-ink-faint">
      확정한 매칭이 없어요. 게시글 상세의 “AI 매칭 → 매칭하기”를 눌러보세요.
    </p>
  );

  if (lostIds.length === 0 && foundIds.length === 0) return empty;

  const filters = [];
  if (lostIds.length) filters.push(`lost_post_id.in.(${lostIds.join(",")})`);
  if (foundIds.length) filters.push(`found_post_id.in.(${foundIds.join(",")})`);

  const { data: matches } = await supabase
    .from("matches")
    .select(
      `id, score, created_at, completed_at,
       lost:lost_posts ( id, title, user_id, status, author:profiles!user_id(nickname) ),
       found:found_posts ( id, title, user_id, status, author:profiles!user_id(nickname) )`,
    )
    .or(filters.join(","))
    .order("created_at", { ascending: false });

  if (!matches || matches.length === 0) return empty;

  return (
    <ul className="space-y-2.5">
      {matches.map((m) => {
        const mineIsLost = m.lost?.user_id === userId;
        const myPost = mineIsLost ? m.lost : m.found;
        const myKind = mineIsLost ? "lost" : "found";
        const other = mineIsLost ? m.found : m.lost;
        const otherKind = mineIsLost ? "found" : "lost";

        return (
          <li key={m.id} className="card p-4">
            <div className="flex items-center justify-between">
              {m.completed_at ? (
                <span className="chip bg-brand text-white">🎉 되찾음 완료</span>
              ) : (
                <span className="chip bg-brand-tint text-brand-deep">
                  {Math.round((m.score || 0) * 100)}% 일치
                </span>
              )}
              {!m.completed_at && <CancelMatchButton matchId={m.id} />}
            </div>
            <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
              <Link
                href={`/${myKind}/${myPost?.id}`}
                className="rounded-lg bg-brand-tint p-3 transition hover:bg-brand-soft/40"
              >
                <p className="text-xs font-semibold text-brand-deep">
                  내 게시글
                </p>
                <p className="mt-0.5 font-bold">{myPost?.title}</p>
              </Link>
              <Link
                href={`/${otherKind}/${other?.id}`}
                className="rounded-lg bg-sunken p-3 transition hover:bg-line"
              >
                <p className="text-xs text-ink-faint">
                  상대 · {other?.author?.nickname || "알 수 없음"}
                </p>
                <p className="mt-0.5 font-bold">{other?.title}</p>
              </Link>
            </div>

            {!m.completed_at && (
              <div className="mt-3 flex justify-end">
                <CompleteMatchButton matchId={m.id} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
