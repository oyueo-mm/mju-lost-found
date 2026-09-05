import Link from "next/link";

import { requireReadyUser } from "@/lib/auth/session";
import { listMyMatchesSummary } from "@/lib/match/service";
import { MyMatchActions } from "@/components/match/MyMatchActions";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

// "내 매칭" (Phase 11) -- unlike the legacy Streamlit page this mirrors
// the *intent* of (pages/4_내_매칭.py: "모든 확정 매칭을 한 화면에서"),
// this app already integrated per-post match management into MatchPanel
// (see /post/[id]) rather than copying legacy's separate-page structure
// wholesale (see the Phase 8 gap analysis's §8 "재설계 필요" note). This
// page is the missing cross-post summary MatchPanel structurally can't
// provide (it's scoped to one post), not a replacement for it.
//
// userId comes only from the session (requireReadyUser()) -- never a
// query param -- and listMyMatchesSummary() itself scopes its query to
// rows where the user owns one side of the Match, so there's no path for
// another user's matches to appear here.
export default async function MyMatchesPage() {
  const user = await requireReadyUser("match", "/matches");

  let matches;
  try {
    matches = await listMyMatchesSummary(user.id);
  } catch (error) {
    console.error("Failed to load my matches", error);
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">내 매칭</h1>
        <div className="rounded-lg border border-red-200 bg-red-50 p-10 text-center text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          매칭 목록을 불러오는 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">내 매칭</h1>

      {matches.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          아직 확정된 매칭이 없습니다. 게시물 상세 화면의 AI 매칭 후보에서 &apos;매칭하기&apos;를 눌러 매칭을 확정해보세요.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {matches.map((m) => (
            <div
              key={m.id}
              className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-500 dark:text-zinc-400">
                  상대방: {m.counterpart.nickname ?? "알 수 없음"}
                </span>
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  매칭 확정일: {formatDate(m.createdAt)}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Link
                  href={`/post/${m.myPost.id}?type=${m.myPost.type}`}
                  className="flex flex-col gap-1 rounded-md border border-zinc-200 p-3 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
                >
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">
                    내 게시글 ({m.myPost.type === "lost" ? "분실물" : "습득물"})
                  </span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">{m.myPost.title}</span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">상태: {m.myPost.status}</span>
                </Link>

                <Link
                  href={`/post/${m.counterpartPost.id}?type=${m.counterpartPost.type}`}
                  className="flex flex-col gap-1 rounded-md border border-zinc-200 p-3 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
                >
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">
                    상대 게시글 ({m.counterpartPost.type === "lost" ? "분실물" : "습득물"})
                  </span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">{m.counterpartPost.title}</span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">상태: {m.counterpartPost.status}</span>
                </Link>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  AI 유사도 점수: {m.score.toFixed(2)} (높을수록 의미가 비슷합니다)
                </span>
                <MyMatchActions matchId={m.id} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
