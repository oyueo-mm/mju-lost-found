import Link from "next/link";
import { requireAdmin, roleOf } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/format";
import AdminUserControls from "@/components/admin/AdminUserControls";
import Icon from "@/components/Icon";

export const metadata = { title: "사용자 관리 · 관리자" };

const ROLE_LABEL = { owner: "총관리자", admin: "관리자" };

export default async function AdminUsersPage({ searchParams }) {
  const { user: me } = await requireAdmin();
  const sp = await searchParams;
  const search = (sp.q || "").trim();

  const admin = createAdminClient();
  let req = admin
    .from("profiles")
    .select(
      "id, nickname, email, major, member_type, role, is_admin, is_suspended, suspended_until, suspension_reason, appeal_text, appeal_at, created_at",
    )
    .order("role", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(300);
  if (search) {
    req = req.or(`nickname.ilike.%${search}%,email.ilike.%${search}%`);
  }
  const { data: users } = await req;

  return (
    <div>
      <div className="flex items-center gap-2">
        <Link
          href="/admin"
          className="grid h-8 w-8 place-items-center rounded-full text-ink-soft transition hover:bg-sunken"
        >
          <Icon name="back" size={17} />
        </Link>
        <h1 className="text-xl font-extrabold">사용자 관리</h1>
      </div>

      <form method="get" className="mt-3 flex gap-2">
        <input
          name="q"
          type="text"
          autoComplete="off"
          defaultValue={search}
          placeholder="닉네임·이메일 검색"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <button type="submit" className="btn btn-ghost px-4 py-2 text-sm">
          검색
        </button>
      </form>

      <p className="mt-3 text-sm text-ink-faint">{users?.length || 0}명</p>

      <div className="mt-2 space-y-2">
        {(users || []).map((u) => {
          const role = u.role === "owner" ? "owner" : roleOf(u);
          const suspended =
            u.is_suspended &&
            (!u.suspended_until ||
              new Date(u.suspended_until).getTime() > Date.now());
          return (
            <div key={u.id} className="card p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/admin/users/${u.id}`}
                  className="font-bold underline decoration-line underline-offset-2 transition hover:decoration-brand"
                >
                  {u.nickname || "(닉네임 없음)"}
                </Link>
                {ROLE_LABEL[role] && (
                  <span className="chip bg-brand text-white">
                    {ROLE_LABEL[role]}
                  </span>
                )}
                {u.member_type && (
                  <span className="chip bg-sunken text-ink-soft">
                    {u.member_type}
                  </span>
                )}
                {suspended && (
                  <span className="chip bg-brand-tint text-brand-deep">
                    정지{u.suspended_until ? "" : " (영구)"}
                  </span>
                )}
                {u.id === me.id && (
                  <span className="chip bg-sunken text-ink-faint">나</span>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-ink-faint">
                {u.email} · {u.major || "학과 미상"} ·{" "}
                {formatDateTime(u.created_at)}
              </p>
              {suspended && u.suspended_until && (
                <p className="text-xs text-ink-faint">
                  ~ {formatDateTime(u.suspended_until)}
                </p>
              )}
              {suspended && u.suspension_reason && (
                <p className="mt-1 text-xs text-ink-soft">
                  사유: {u.suspension_reason}
                </p>
              )}
              {suspended && u.appeal_text && (
                <div className="mt-2 rounded-lg border border-brand-soft bg-brand-tint p-2.5">
                  <p className="text-[11px] font-bold text-brand-deep">
                    이의 제기{" "}
                    {u.appeal_at && (
                      <span className="font-normal">
                        · {formatDateTime(u.appeal_at)}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-ink-soft">
                    {u.appeal_text}
                  </p>
                </div>
              )}
              <AdminUserControls
                userId={u.id}
                role={role}
                isSuspended={suspended}
                self={u.id === me.id}
                isOwner={role === "owner"}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
