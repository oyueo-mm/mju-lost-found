import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/format";
import ReportActions from "@/components/ReportActions";
import TranscriptGate from "@/components/admin/TranscriptGate";
import Icon from "@/components/Icon";

export const metadata = { title: "신고 상세 · 관리자" };

const TARGET_LABEL = {
  lost_post: "분실 게시글",
  found_post: "습득 게시글",
  message: "채팅 메시지",
  user: "사용자",
};

async function loadContext(admin, report) {
  if (report.target_type === "message") {
    const { data: msg } = await admin
      .from("messages")
      .select("id, room_id, sender_id, content, image_url, created_at, hidden_at, sender:profiles!sender_id(nickname)")
      .eq("id", report.target_id)
      .maybeSingle();
    if (!msg) return { type: "message", missing: true };

    const { data: around } = await admin
      .from("messages")
      .select("id, sender_id, content, image_url, created_at, sender:profiles!sender_id(nickname)")
      .eq("room_id", msg.room_id)
      .order("created_at", { ascending: true })
      .limit(500);

    const idx = (around || []).findIndex((m) => m.id === msg.id);
    const slice = (around || []).slice(
      Math.max(0, idx - 8),
      idx + 4,
    );
    return { type: "message", msg, transcript: slice };
  }

  if (report.target_type === "lost_post" || report.target_type === "found_post") {
    const table =
      report.target_type === "lost_post" ? "lost_posts" : "found_posts";
    const { data: post } = await admin
      .from(table)
      .select("id, title, description, image_url, image_urls, author:profiles!user_id(nickname)")
      .eq("id", report.target_id)
      .maybeSingle();
    return { type: "post", post, kind: table === "lost_posts" ? "lost" : "found" };
  }

  return { type: "other" };
}

export default async function ReportDetailPage({ params }) {
  const { user: me } = await requireAdmin();
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();

  const admin = createAdminClient();
  const { data: report } = await admin
    .from("reports")
    .select("*, reporter:profiles!reporter_id(nickname), resolver:profiles!resolved_by(nickname)")
    .eq("id", id)
    .maybeSingle();
  if (!report) notFound();

  // 채팅 신고는 관리자 전원 동의가 있어야 대화 열람
  let transcriptUnlocked = report.target_type !== "message";
  let gate = null;
  if (report.target_type === "message") {
    const [{ count: staffCount }, { data: approvals }] = await Promise.all([
      admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin"),
      admin
        .from("report_transcript_approvals")
        .select("admin_id")
        .eq("report_id", id),
    ]);
    const needed = staffCount || 1;
    const approved = approvals?.length || 0;
    transcriptUnlocked = approved >= needed;
    gate = {
      needed,
      approved,
      iApproved: (approvals || []).some((a) => a.admin_id === me.id),
    };
  }

  const ctx = transcriptUnlocked
    ? await loadContext(admin, report)
    : { type: "message", locked: true };
  const hasAuthor =
    report.target_type === "lost_post" || report.target_type === "found_post";

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link
          href="/admin/reports"
          className="grid h-8 w-8 place-items-center rounded-full text-ink-soft transition hover:bg-sunken"
        >
          <Icon name="back" size={17} />
        </Link>
        <h1 className="text-xl font-extrabold">신고 상세</h1>
      </div>

      <section className="card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip bg-brand-tint text-brand-deep">
            {TARGET_LABEL[report.target_type]}
          </span>
          <span className="font-bold">{report.reason}</span>
          <span
            className={`chip ${
              report.status === "pending"
                ? "bg-sunken text-ink-soft"
                : "bg-brand text-white"
            }`}
          >
            {report.status === "pending"
              ? "대기"
              : report.status === "dismissed"
                ? "기각"
                : "처리됨"}
          </span>
        </div>
        {report.detail && (
          <p className="mt-2 text-sm text-ink-soft">{report.detail}</p>
        )}
        <p className="mt-2 text-xs text-ink-faint">
          신고자: {report.reporter?.nickname || "?"} ·{" "}
          {formatDateTime(report.created_at)}
          {report.resolved_at &&
            ` · 처리: ${report.resolver?.nickname || "?"} (${formatDateTime(report.resolved_at)})`}
        </p>
      </section>

      {/* 대화 맥락 */}
      {ctx.type === "message" && ctx.locked && (
        <TranscriptGate
          reportId={report.id}
          approved={gate.approved}
          needed={gate.needed}
          iApproved={gate.iApproved}
        />
      )}

      {ctx.type === "message" && !ctx.locked && (
        <section className="card p-4">
          <h2 className="font-bold">대화 내용</h2>
          {ctx.missing ? (
            <p className="mt-2 text-sm text-ink-faint">
              메시지가 삭제되었어요.
            </p>
          ) : (
            <div className="mt-3 space-y-1.5">
              {ctx.transcript.map((m) => {
                const isTarget = m.id === ctx.msg.id;
                return (
                  <div
                    key={m.id}
                    className={`rounded-lg px-3 py-2 text-sm ${
                      isTarget
                        ? "border border-brand bg-brand-tint"
                        : "bg-sunken"
                    }`}
                  >
                    <p className="text-xs text-ink-faint">
                      {m.sender?.nickname || "?"} ·{" "}
                      {formatDateTime(m.created_at)}
                      {isTarget && " · 신고된 메시지"}
                    </p>
                    {m.image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={m.image_url}
                        alt=""
                        className="mt-1 max-h-48 rounded-lg border border-line object-contain"
                      />
                    )}
                    {m.content && (
                      <p className="mt-0.5 whitespace-pre-wrap break-words">
                        {m.content}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {ctx.type === "post" && ctx.post && (
        <section className="card p-4">
          <h2 className="font-bold">게시글 내용</h2>
          <p className="mt-2 font-bold">{ctx.post.title}</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-soft">
            {ctx.post.description}
          </p>
          <p className="mt-2 text-xs text-ink-faint">
            작성자: {ctx.post.author?.nickname || "?"}
          </p>
          <Link
            href={`/${ctx.kind}/${ctx.post.id}`}
            className="mt-2 inline-block text-sm font-semibold text-brand-strong"
          >
            게시글 페이지 보기
          </Link>
        </section>
      )}

      {report.status === "pending" && (
        <section className="card p-4">
          <h2 className="font-bold">처리</h2>
          <ReportActions reportId={report.id} hasAuthor={hasAuthor} />
        </section>
      )}
    </div>
  );
}
