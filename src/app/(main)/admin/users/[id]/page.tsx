import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth/session";
import { getUserDetailForAdmin } from "@/lib/admin/users";
import { UserActionButtons } from "@/components/admin/UserActionButtons";
import { AuthorLink } from "@/components/user/AuthorLink";
import { MyCommentList } from "@/components/comment/MyCommentList";
import { ShieldIcon } from "@/components/icons";

// Vercel's Node runtime defaults to UTC (no TZ env var set), so formatting
// without an explicit timeZone renders 9 hours behind actual KST -- same
// fix (auth)/suspended/page.tsx already applies to its own date display.
function formatDateTime(date: Date | null): string {
  if (!date) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(
    date,
  );
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

        {/* Phase P-1: lastLoginAt only -- "현재 접속 중" is deliberately not
            shown here (see AdminUserDetailDTO's own comment: a valid JWT
            session doesn't mean the user is actually active right now, and
            this app has no presence/heartbeat signal to tell the two apart
            without a larger change). */}
        <Section title="접속 정보">
          <Field label="마지막 로그인" value={formatDateTime(lastLoginAt)} />
        </Section>

        <Section title="활동 정보">
          <Field label="분실물 게시글" value={`${lostPostCount}건`} />
          <Field label="습득물 게시글" value={`${foundPostCount}건`} />
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
