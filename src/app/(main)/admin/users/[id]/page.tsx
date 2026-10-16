import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth/session";
import { getUserDetailForAdmin } from "@/lib/admin/users";
import { UserActionButtons } from "@/components/admin/UserActionButtons";
import { AuthorLink } from "@/components/user/AuthorLink";
import { MyCommentList } from "@/components/comment/MyCommentList";
import { ShieldIcon } from "@/components/icons";
import { COLLECTION_SINCE } from "@/lib/metrics/report";
import { LAST_ACTIVE_INTERVAL_MINUTES } from "@/lib/metrics/activityTime";
import { ACTIVITY_RETENTION_DAYS } from "@/lib/retention/policy";

// Vercel's Node runtime defaults to UTC (no TZ env var set), so formatting
// without an explicit timeZone renders 9 hours behind actual KST -- same
// fix (auth)/suspended/page.tsx already applies to its own date display.
function formatDateTime(date: Date | null): string {
  if (!date) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(
    date,
  );
}

// 접속 정보: exact KST time to the second ("YYYY-MM-DD HH:mm:ss"), the
// way the times are stored -- no locale formatting, no rounding.
function formatKstSeconds(date: Date): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">{title}</h2>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">{children}</dl>
    </section>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 sm:justify-start">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground sm:text-left">{value}</dd>
    </div>
  );
}

// Phase P-1: admin-only user detail page -- requireAdmin() (page gate) +
// getUserDetailForAdmin()'s own isAdmin() re-check (service-layer gate),
// same belt-and-suspenders convention every other admin-only page/service
// pair in this app already follows. Reads getUserDetailForAdmin() directly
// (a Server Component calling a server function), not through a new API
// route -- avoids adding another Vercel Serverless Function for what's only
// ever rendered here (see this app's function-count constraint).
export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  const result = await getUserDetailForAdmin(admin, id);
  if (result.kind === "forbidden") redirect("/");
  // getUserDetailForAdmin only ever returns "ok" | "forbidden" | "not_found"
  // in practice (the shared AdminUserMutationResult<T> type also carries
  // "self"/"reason_required" for updateUserByAdmin's own use) -- treat any
  // other kind the same as not_found rather than assuming it can't happen.
  if (result.kind !== "ok") notFound();

  const {
    user,
    name,
    googleLinked,
    lastLoginAt,
    lastActivityDay,
    lastActiveAt,
    lastActiveSince,
    lostPostCount,
    foundPostCount,
    commentCount,
    reportsFiledCount,
    reportsAgainstCount,
    comments,
  } = result.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/admin/users" className="text-sm text-muted-foreground hover:underline">
          ← 사용자 관리로 돌아가기
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <ShieldIcon className="size-5 text-primary" />
          <h1 className="text-xl font-semibold text-foreground">
            <AuthorLink nickname={user.nickname} publicId={user.publicId} />
          </h1>
          {user.isAdmin && (
            <span className="rounded-full bg-primary-muted px-2 py-0.5 text-[11px] font-medium text-primary">
              관리자
            </span>
          )}
          {user.currentlySuspended && (
            <span className="rounded-full bg-destructive-muted px-2 py-0.5 text-[11px] font-medium text-destructive">
              정지됨
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <Section title="사용자 기본 정보">
          <Field label="닉네임" value={user.nickname ?? "설정 안 함"} />
          <Field label="구글 표시 이름" value={name} />
          <Field label="이메일" value={user.email} />
          <Field label="Public ID" value={<span className="font-mono text-xs">{user.publicId}</span>} />
          <Field
            label="공개 프로필"
            value={
              <Link href={`/profile/${user.publicId}`} className="underline">
                프로필 보기
              </Link>
            }
          />
        </Section>

        <Section title="계정 정보">
          <Field label="계정 생성일" value={formatDateTime(user.createdAt)} />
          <Field label="구글 계정 연동" value={googleLinked ? "연동됨" : "연동 안 됨"} />
          <Field label="관리자 권한" value={user.isAdmin ? "있음" : "없음"} />
        </Section>

        {/* Three different records: the last completed Google sign-in, the
            last detected signed-in activity (stored every few minutes), and
            the last KST day with an activity mark. None is presence, a
            log-out or a leave time; nothing missing is ever estimated. */}
        <Section title="접속 정보">
          <Field label="최근 로그인 시각" value={lastLoginAt ? `${formatKstSeconds(lastLoginAt)} (KST)` : "기록 없음"} />
          <Field
            label="최근 활동 감지 시각"
            value={lastActiveAt ? `${formatKstSeconds(lastActiveAt)} (KST)` : lastActiveSince ? "기록 없음" : "미측정"}
          />
          <Field label="최근 이용일" value={lastActivityDay ? `${lastActivityDay} (KST)` : "기록 없음"} />
          <div className="sm:col-span-2 text-xs leading-relaxed text-muted-foreground">
            <dt className="sr-only">접속 정보 측정 기준</dt>
            <dd>
              <ul className="flex list-disc flex-col gap-1 pl-4">
                <li>
                  <b className="font-medium text-foreground">최근 로그인 시각</b>: Google 로그인을 새로 마친 시각입니다. 로그인 상태는 최대 30일
                  유지되므로, 로그인한 채로 다시 방문해도 바뀌지 않습니다.
                </li>
                <li>
                  <b className="font-medium text-foreground">최근 활동 감지 시각</b>: 로그인 상태에서 화면을 열거나, 보이는 화면을 터치·클릭·스크롤·입력한
                  것이 마지막으로 기록된 시각입니다(로그인 유지 중 재방문 포함). 서버 부하를 줄이려고 {LAST_ACTIVE_INTERVAL_MINUTES}분에 한 번(시간대가
                  바뀌면 바로)만 갱신하므로 실제 마지막 활동은 표시 시각보다 최대 {LAST_ACTIVE_INTERVAL_MINUTES}분 늦을 수 있습니다. 로그아웃하거나
                  사이트를 떠난 시각이 아니며, 화면을 띄워 두기만 한 시간이나 백그라운드 탭은 포함하지 않습니다.{" "}
                  {lastActiveSince
                    ? `${lastActiveSince}(KST)부터 기록하며, 그 전의 접속 시각은 기록하지 않아 알 수 없습니다.`
                    : "이 환경에서는 아직 기록을 시작하지 않았습니다(미측정)."}
                </li>
                <li>
                  <b className="font-medium text-foreground">최근 이용일</b>: 로그인 상태로 이용한 날짜(하루 단위) 기록입니다.{" "}
                  {COLLECTION_SINCE.ops.replace("T", " ")}(KST) 이후 수집된 최근 {ACTIVITY_RETENTION_DAYS}일 보관 범위의 기록입니다.
                </li>
                <li>기록이 없어도 서비스를 이용하지 않았다는 뜻은 아닙니다. 회원탈퇴 시 최근 활동 감지 시각과 이용일 기록은 삭제됩니다.</li>
              </ul>
            </dd>
          </div>
        </Section>

        <Section title="활동 정보">
          {/* Phase 11-1: reuses /admin/posts' existing author(닉네임) 필터
              그대로 -- 새 게시글 관리 화면을 만들지 않는다. 닉네임이 아직
              없는 사용자(온보딩 전)는 필터링할 값이 없어 링크 없이 개수만
              표시한다. */}
          <Field
            label="분실물 게시글"
            value={
              user.nickname ? (
                <Link
                  href={`/admin/posts?type=lost&author=${encodeURIComponent(user.nickname)}`}
                  className="underline hover:text-primary"
                >
                  {lostPostCount}건 보기
                </Link>
              ) : (
                `${lostPostCount}건`
              )
            }
          />
          <Field
            label="습득물 게시글"
            value={
              user.nickname ? (
                <Link
                  href={`/admin/posts?type=found&author=${encodeURIComponent(user.nickname)}`}
                  className="underline hover:text-primary"
                >
                  {foundPostCount}건 보기
                </Link>
              ) : (
                `${foundPostCount}건`
              )
            }
          />
          <Field label="댓글" value={`${commentCount}건`} />
        </Section>

        <Section title="제재 · 신고 정보">
          <Field label="현재 상태" value={user.currentlySuspended ? "정지됨" : "정상"} />
          <Field label="정지 해제 예정" value={user.suspendedUntil ? formatDateTime(user.suspendedUntil) : "해당 없음"} />
          <Field label="정지 처리자" value={user.suspendedByNickname ?? "기록 없음"} />
          <Field label="신고당한 횟수 (본인 계정 대상)" value={`${reportsAgainstCount}건`} />
          <Field label="신고 접수한 횟수" value={`${reportsFiledCount}건`} />
        </Section>

        {/* Phase P-1 follow-up: reuses MyCommentList unchanged (same
            component /me/comments renders) -- its delete button already
            works for an admin viewing someone else's comments, since
            comment/service.ts's deleteComment() allows either the owner or
            an admin, not owner-only. */}
        <section className="rounded-card border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">작성한 댓글 ({commentCount}건)</h2>
          <MyCommentList comments={comments} />
        </section>
      </div>

      <div className="flex justify-end">
        <UserActionButtons user={user} isSelf={user.id === admin.id} />
      </div>
    </div>
  );
}
