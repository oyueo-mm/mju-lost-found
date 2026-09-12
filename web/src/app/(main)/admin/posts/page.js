import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { KIND_CONFIG } from "@/lib/constants";
import { CAMPUSES, campusLabel } from "@/lib/campus";
import { timeAgo } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import AdminPostControls from "@/components/admin/AdminPostControls";
import Icon from "@/components/Icon";

export const metadata = { title: "게시글 관리 · 관리자" };

const q = (obj) => new URLSearchParams(obj).toString();

export default async function AdminPostsPage({ searchParams }) {
  await requireAdmin();
  const sp = await searchParams;
  const board = ["lost", "found"].includes(sp.board) ? sp.board : "all";
  const campus = ["humanities", "natural"].includes(sp.campus) ? sp.campus : "";

  const admin = createAdminClient();
  const tables =
    board === "lost"
      ? [["lost_posts", "lost"]]
      : board === "found"
        ? [["found_posts", "found"]]
        : [
            ["lost_posts", "lost"],
            ["found_posts", "found"],
          ];

  const rows = [];
  for (const [table, kind] of tables) {
    let req = admin
      .from(table)
      .select("id, title, status, campus, created_at, author:profiles!user_id(nickname)")
      .order("created_at", { ascending: false })
      .limit(150);
    if (campus) req = req.eq("campus", campus);
    const { data } = await req;
    (data || []).forEach((p) => rows.push({ ...p, kind }));
  }
  // 진행 중인 글을 위로, 완료된 글을 아래로. 그 안에서는 최신순.
  const isOpen = (p) => p.status === KIND_CONFIG[p.kind].defaultStatus;
  rows.sort((a, b) => {
    if (isOpen(a) !== isOpen(b)) return isOpen(a) ? -1 : 1;
    return a.created_at < b.created_at ? 1 : -1;
  });

  const chip = (active, label, params) => (
    <Link
      href={`/admin/posts${Object.keys(params).length ? "?" + q(params) : ""}`}
      className={`chip ${active ? "bg-brand text-white" : "bg-sunken text-ink-soft"}`}
    >
      {label}
    </Link>
  );

  return (
    <div>
      <div className="flex items-center gap-2">
        <Link
          href="/admin"
          className="grid h-8 w-8 place-items-center rounded-full text-ink-soft transition hover:bg-sunken"
        >
          <Icon name="back" size={17} />
        </Link>
        <h1 className="text-xl font-extrabold">게시글 관리</h1>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {chip(board === "all", "전체", campus ? { campus } : {})}
        {chip(board === "lost", "분실", { board: "lost", ...(campus && { campus }) })}
        {chip(board === "found", "습득", { board: "found", ...(campus && { campus }) })}
        <span className="mx-1 text-ink-faint">|</span>
        {chip(!campus, "전체 캠퍼스", board !== "all" ? { board } : {})}
        {Object.values(CAMPUSES).map((c) =>
          chip(campus === c.key, c.label, {
            campus: c.key,
            ...(board !== "all" && { board }),
          }),
        )}
      </div>

      <div className="mt-4 space-y-2">
        {rows.length === 0 ? (
          <p className="card-dashed p-8 text-center text-sm text-ink-faint">
            게시글이 없어요.
          </p>
        ) : (
          rows.map((p) => {
            const cfg = KIND_CONFIG[p.kind];
            const done = p.status !== cfg.defaultStatus;
            return (
              <div
                key={`${p.kind}-${p.id}`}
                className={`card p-3.5 ${done ? "opacity-55" : ""}`}
              >
                <div className="flex items-start gap-2">
                  <span className={`chip shrink-0 ${cfg.tint} ${cfg.tintText}`}>
                    {cfg.label}
                  </span>
                  <Link
                    href={`/${p.kind}/${p.id}`}
                    className="min-w-0 flex-1 truncate font-bold hover:text-brand-strong"
                  >
                    {p.title}
                  </Link>
                  <StatusBadge status={p.status} />
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <p className="truncate text-xs text-ink-faint">
                    {campusLabel(p.campus)} · {p.author?.nickname || "?"} ·{" "}
                    {timeAgo(p.created_at)}
                  </p>
                  <AdminPostControls kind={p.kind} id={p.id} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
