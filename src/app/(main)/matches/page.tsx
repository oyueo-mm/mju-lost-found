import Link from "next/link";

import { requireReadyUser } from "@/lib/auth/session";
import { listMyMatchesSummary } from "@/lib/match/service";
import { MyMatchActions } from "@/components/match/MyMatchActions";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";

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
        <h1 className="text-xl font-semibold text-foreground">내 매칭</h1>
        <div className="rounded-card border border-destructive/30 bg-destructive-muted p-10 text-center text-sm text-destructive">
          매칭 목록을 불러오지 못했어요. 잠시 후 다시 시도해주세요.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-foreground">내 매칭</h1>

      {matches.length === 0 ? (
        <EmptyState
          title="아직 확정된 매칭이 없어요."
          description="게시물 상세 화면의 AI 매칭 후보에서 '매칭하기'를 눌러 매칭을 확정해보세요."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {matches.map((m) => (
            <div key={m.id} className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">상대방: {m.counterpart.nickname ?? "알 수 없음"}</span>
                <span className="text-xs text-muted-foreground">매칭 확정일: {formatDate(m.createdAt)}</span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Link
                  href={`/post/${m.myPost.id}?type=${m.myPost.type}`}
                  className="flex flex-col gap-1 rounded-lg border border-border p-3 transition-colors hover:border-foreground/30"
                >
                  <span className="text-xs text-muted-foreground">
                    내 게시글 ({m.myPost.type === "lost" ? "분실물" : "습득물"})
                  </span>
                  <span className="font-medium text-foreground">{m.myPost.title}</span>
                  <StatusBadge status={m.myPost.status} className="w-fit" />
                </Link>

                <Link
                  href={`/post/${m.counterpartPost.id}?type=${m.counterpartPost.type}`}
                  className="flex flex-col gap-1 rounded-lg border border-border p-3 transition-colors hover:border-foreground/30"
                >
                  <span className="text-xs text-muted-foreground">
                    상대 게시글 ({m.counterpartPost.type === "lost" ? "분실물" : "습득물"})
                  </span>
                  <span className="font-medium text-foreground">{m.counterpartPost.title}</span>
                  <StatusBadge status={m.counterpartPost.status} className="w-fit" />
                </Link>
              </div>

              <div className="flex items-center justify-between">
                <span className="rounded-full bg-primary-muted px-2.5 py-1 text-xs font-medium text-primary">
                  AI 유사도 {Math.round(m.score * 100)}%
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
