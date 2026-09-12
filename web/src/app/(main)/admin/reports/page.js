import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/format";
import ReportActions from "@/components/ReportActions";
import Icon from "@/components/Icon";

export const metadata = { title: "신고 처리 · 관리자" };

const TARGET_LABEL = {
  lost_post: "분실 게시글",
  found_post: "습득 게시글",
  message: "채팅 메시지",
  user: "사용자",
};

function targetLink(type, id) {
  if (type === "lost_post") return `/lost/${id}`;
  if (type === "found_post") return `/found/${id}`;
  return null;
}

export default async function AdminReportsPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const { data: reports } = await admin
    .from("reports")
    .select("*, reporter:profiles!reporter_id(nickname)")
    .order("status", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(200);

  const list = reports || [];
  const pending = list.filter((r) => r.status === "pending");
  const done = list.filter((r) => r.status !== "pending");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href="/admin"
          className="grid h-8 w-8 place-items-center rounded-full text-ink-soft transition hover:bg-sunken"
        >
          <Icon name="back" size={17} />
        </Link>
        <h1 className="text-xl font-extrabold">신고 처리</h1>
      </div>

      <section>
        <h2 className="font-bold">처리 대기 ({pending.length})</h2>
        <div className="mt-2.5 space-y-3">
          {pending.length === 0 ? (
            <p className="card-dashed p-6 text-center text-sm text-ink-faint">
              처리할 신고가 없어요.
            </p>
          ) : (
            pending.map((r) => {
              const link = targetLink(r.target_type, r.target_id);
              const hasAuthor =
                r.target_type === "lost_post" || r.target_type === "found_post";
              return (
                <div key={r.id} className="card p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">
                      {TARGET_LABEL[r.target_type]} · {r.reason}
                    </span>
                    <span className="text-xs text-ink-faint">
                      {formatDateTime(r.created_at)}
                    </span>
                  </div>
                  {r.detail && (
                    <p className="mt-1 text-sm text-ink-soft">{r.detail}</p>
                  )}
                  <p className="mt-1 text-xs text-ink-faint">
                    신고자: {r.reporter?.nickname || "?"} · 대상 #{r.target_id}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Link
                      href={`/admin/reports/${r.id}`}
                      className="btn btn-ghost px-3.5 py-1.5 text-xs"
                    >
                      {r.target_type === "message"
                        ? "대화 내용 보기"
                        : "자세히 보기"}
                    </Link>
                    {link && (
                      <Link
                        href={link}
                        className="btn px-3.5 py-1.5 text-xs text-brand-strong"
                      >
                        대상 페이지
                      </Link>
                    )}
                  </div>
                  <ReportActions reportId={r.id} hasAuthor={hasAuthor} />
                </div>
              );
            })
          )}
        </div>
      </section>

      {done.length > 0 && (
        <section>
          <h2 className="font-bold text-ink-soft">처리 완료 ({done.length})</h2>
          <div className="mt-2 space-y-2">
            {done.map((r) => (
              <div key={r.id} className="card p-3 text-sm text-ink-faint">
                {TARGET_LABEL[r.target_type]} · {r.reason} ·{" "}
                {r.status === "dismissed" ? "기각" : "처리됨"}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
