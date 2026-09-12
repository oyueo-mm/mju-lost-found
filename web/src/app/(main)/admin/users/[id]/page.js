import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin, roleOf } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime, timeAgo } from "@/lib/format";
import Icon from "@/components/Icon";
import AdminUserControls from "@/components/admin/AdminUserControls";

export const metadata = { title: "사용자 상세 · 관리자" };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Row({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5">
      <span className="shrink-0 text-sm text-ink-faint">{label}</span>
      <span className="min-w-0 break-all text-right text-sm font-semibold">
        {children ?? "-"}
      </span>
    </div>
  );
}

export default async function AdminUserDetailPage({ params }) {
  const { user: me } = await requireAdmin();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const admin = createAdminClient();

  const { data: p } = await admin
    .from("profiles")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!p) notFound();

  const [
    authRes,
    lostRes,
    foundRes,
    reportsBy,
    reportsOnUser,
    commentsCnt,
    roomsRes,
  ] = await Promise.all([
    admin.auth.admin.getUserById(id).catch(() => ({ data: null })),
    admin
      .from("lost_posts")
      .select("id, title, status, created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false }),
    admin
      .from("found_posts")
      .select("id, title, status, created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false }),
    admin
      .from("reports")
      .select("id", { count: "exact", head: true })
      .eq("reporter_id", id),
    admin
      .from("reports")
      .select("id, reason, status, created_at")
      .eq("target_type", "user")
      .eq("target_id", id)
      .order("created_at", { ascending: false }),
    admin
      .from("comments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", id),
    admin
      .from("chat_rooms")
      .select("id", { count: "exact", head: true })
      .or(`user_a.eq.${id},user_b.eq.${id}`),
  ]);

  const authUser = authRes?.data?.user || null;
  const lost = lostRes.data || [];
  const found = foundRes.data || [];
  const posts = [
    ...lost.map((x) => ({ ...x, kind: "lost", label: "분실" })),
    ...found.map((x) => ({ ...x, kind: "found", label: "습득" })),
  ].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  const role = roleOf(p);
  const owner = p.role === "owner";
  const suspended =
    p.is_suspended &&
    (!p.suspended_until || new Date(p.suspended_until).getTime() > Date.now());
  const provider =
    authUser?.identities?.map((i) => i.provider).join(", ") || "google";
  const lastPost = posts[0]?.created_at || null;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link
          href="/admin/users"
          className="grid h-8 w-8 place-items-center rounded-full text-ink-soft transition hover:bg-sunken"
        >
          <Icon name="back" size={17} />
        </Link>
        <h1 className="min-w-0 truncate text-xl font-extrabold">
          {p.nickname || "(닉네임 없음)"}
        </h1>
        {owner ? (
          <span className="chip bg-ink text-white">총관리자</span>
        ) : (
          role === "admin" && (
            <span className="chip bg-brand text-white">관리자</span>
          )
        )}
        {suspended && (
          <span className="chip bg-brand-tint text-brand-deep">
            정지{p.suspended_until ? "" : " (영구)"}
          </span>
        )}
        {p.id === me.id && (
          <span className="chip bg-sunken text-ink-faint">나</span>
        )}
      </div>

      {/* 계정 */}
      <section className="card p-4">
        <h2 className="font-bold">계정</h2>
        <div className="mt-1 divide-y divide-line-soft">
          <Row label="이메일">{p.email}</Row>
          <Row label="구글 계정 이름">{p.name || "-"}</Row>
          <Row label="로그인 방식">{provider}</Row>
          <Row label="가입일">{formatDateTime(p.created_at)}</Row>
          <Row label="최근 로그인">
            {authUser?.last_sign_in_at
              ? `${formatDateTime(authUser.last_sign_in_at)} (${timeAgo(
                  authUser.last_sign_in_at,
                )})`
              : "기록 없음"}
          </Row>
          <Row label="이메일 인증">
            {authUser?.email_confirmed_at
              ? formatDateTime(authUser.email_confirmed_at)
              : "미인증"}
          </Row>
          <Row label="user id">
            <span className="font-mono text-xs">{p.id}</span>
          </Row>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
          접속 이력 전체와 IP 주소는 저장하지 않아요. “최근 로그인”은 Supabase
          인증이 기록하는 마지막 1건이에요.
        </p>
      </section>

      {/* 프로필 */}
      <section className="card p-4">
        <h2 className="font-bold">프로필</h2>
        <div className="mt-1 divide-y divide-line-soft">
          <Row label="닉네임">{p.nickname || "미설정"}</Row>
          <Row label="닉네임 마지막 변경">
            {p.nickname_changed_at
              ? formatDateTime(p.nickname_changed_at)
              : "변경 이력 없음"}
          </Row>
          <Row label="전공 / 학과">{p.major || "-"}</Row>
          <Row label="신분">{p.member_type || "-"}</Row>
          <Row label="명지도">
            {p.trust_score != null ? `${p.trust_score}%` : "-"}
          </Row>
          <Row label="권한">
            {owner ? "총관리자" : role === "admin" ? "관리자" : "일반"}
          </Row>
        </div>
      </section>

      {/* 약관 동의 */}
      <section className="card p-4">
        <h2 className="font-bold">약관 동의</h2>
        <div className="mt-1 divide-y divide-line-soft">
          <Row label="약관 동의">
            {p.terms_agreed_at ? formatDateTime(p.terms_agreed_at) : "미동의"}
          </Row>
          <Row label="개인정보 동의">
            {p.privacy_agreed_at
              ? formatDateTime(p.privacy_agreed_at)
              : "미동의"}
          </Row>
          <Row label="동의 버전">{p.terms_version || "-"}</Row>
        </div>
      </section>

      {/* 정지 */}
      {suspended && (
        <section className="card border-brand-soft p-4">
          <h2 className="font-bold">정지 상태</h2>
          <div className="mt-1 divide-y divide-line-soft">
            <Row label="해제 예정">
              {p.suspended_until
                ? formatDateTime(p.suspended_until)
                : "영구 (해제일 없음)"}
            </Row>
            <Row label="사유">{p.suspension_reason || "-"}</Row>
          </div>
          {p.appeal_text && (
            <div className="mt-2 rounded-lg bg-brand-tint p-3">
              <p className="text-[11px] font-bold text-brand-deep">
                이의 제기
                {p.appeal_at && ` · ${formatDateTime(p.appeal_at)}`}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">
                {p.appeal_text}
              </p>
            </div>
          )}
        </section>
      )}

      {/* 활동 요약 */}
      <section className="card p-4">
        <h2 className="font-bold">활동</h2>
        <div className="mt-1 divide-y divide-line-soft">
          <Row label="게시물">
            분실 {lost.length} · 습득 {found.length}
          </Row>
          <Row label="댓글">{commentsCnt.count || 0}개</Row>
          <Row label="참여 중인 채팅방">{roomsRes.count || 0}개</Row>
          <Row label="신고한 횟수">{reportsBy.count || 0}회</Row>
          <Row label="받은 신고(사용자 대상)">
            {(reportsOnUser.data || []).length}건
          </Row>
          <Row label="최근 게시물">
            {lastPost ? timeAgo(lastPost) : "없음"}
          </Row>
        </div>
      </section>

      {/* 받은 신고 상세 */}
      {(reportsOnUser.data || []).length > 0 && (
        <section className="card p-4">
          <h2 className="font-bold">받은 신고</h2>
          <ul className="mt-2 divide-y divide-line-soft text-sm">
            {reportsOnUser.data.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate">{r.reason}</span>
                <span className="num shrink-0 text-xs text-ink-faint">
                  {r.status} · {timeAgo(r.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 게시물 목록 */}
      <section className="card p-4">
        <h2 className="font-bold">게시물 {posts.length}건</h2>
        {posts.length === 0 ? (
          <p className="mt-2 text-sm text-ink-faint">등록한 게시물이 없어요.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line-soft">
            {posts.map((post) => (
              <li key={`${post.kind}-${post.id}`}>
                <Link
                  href={`/${post.kind}/${post.id}`}
                  className="flex items-center gap-2 py-2.5 text-sm transition hover:text-brand"
                >
                  <span
                    className={`chip shrink-0 ${
                      post.kind === "lost"
                        ? "bg-brand-tint text-brand-deep"
                        : "bg-amber-tint text-amber-deep"
                    }`}
                  >
                    {post.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{post.title}</span>
                  <span className="num shrink-0 text-xs text-ink-faint">
                    {post.status} · {timeAgo(post.created_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 조치 */}
      <section className="card p-4">
        <h2 className="font-bold">조치</h2>
        <AdminUserControls
          userId={p.id}
          role={role}
          isSuspended={suspended}
          self={p.id === me.id}
          isOwner={owner}
          allowDelete
        />
      </section>
    </div>
  );
}
