import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBetaOpen } from "@/lib/settings";
import { CAMPUSES } from "@/lib/campus";
import BetaToggle from "@/components/admin/BetaToggle";
import Icon from "@/components/Icon";

export const metadata = { title: "관리자 · 명지 분실물 센터" };

async function count(admin, table, build) {
  let q = admin.from(table).select("id", { count: "exact", head: true });
  if (build) q = build(q);
  const { count: c } = await q;
  return c || 0;
}

function Stat({ value, label }) {
  return (
    <div className="card px-3 py-4 text-center">
      <p className="text-2xl font-extrabold text-brand">{value}</p>
      <p className="mt-0.5 text-xs text-ink-faint">{label}</p>
    </div>
  );
}

export default async function AdminDashboard() {
  await requireAdmin();
  const admin = createAdminClient();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const betaOpen = await getBetaOpen();

  const [
    lost,
    found,
    matches,
    resolvedLost,
    resolvedFound,
    users,
    newUsers,
    newPosts,
    pendingReports,
    openInquiries,
    humLost,
    humFound,
    natLost,
    natFound,
  ] = await Promise.all([
    count(admin, "lost_posts"),
    count(admin, "found_posts"),
    count(admin, "matches"),
    count(admin, "lost_posts", (q) => q.eq("status", "찾음")),
    count(admin, "found_posts", (q) => q.eq("status", "완료")),
    count(admin, "profiles"),
    count(admin, "profiles", (q) => q.gte("created_at", weekAgo)),
    Promise.all([
      count(admin, "lost_posts", (q) => q.gte("created_at", weekAgo)),
      count(admin, "found_posts", (q) => q.gte("created_at", weekAgo)),
    ]).then(([a, b]) => a + b),
    count(admin, "reports", (q) => q.eq("status", "pending")),
    count(admin, "inquiries", (q) => q.eq("status", "open")),
    count(admin, "lost_posts", (q) => q.eq("campus", "humanities")),
    count(admin, "found_posts", (q) => q.eq("campus", "humanities")),
    count(admin, "lost_posts", (q) => q.eq("campus", "natural")),
    count(admin, "found_posts", (q) => q.eq("campus", "natural")),
  ]);

  const menu = [
    { href: "/admin/reports", label: "신고 처리", icon: "shield", badge: pendingReports },
    { href: "/admin/inquiries", label: "문의 관리", icon: "chat", badge: openInquiries },
    { href: "/admin/posts", label: "게시글 관리", icon: "text" },
    { href: "/admin/users", label: "사용자 관리", icon: "user" },
    { href: "/admin/notice", label: "공지 보내기", icon: "bell" },
  ];

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-extrabold">관리자</h1>

      <div className="grid grid-cols-3 gap-2">
        <Stat value={lost + found} label="전체 게시글" />
        <Stat value={matches} label="확정 매칭" />
        <Stat value={resolvedLost + resolvedFound} label="완료(되찾음)" />
        <Stat value={users} label="사용자" />
        <Stat value={newPosts} label="7일 신규글" />
        <Stat value={newUsers} label="7일 신규가입" />
      </div>

      <section className="card p-4">
        <h2 className="font-bold">캠퍼스별 게시글</h2>
        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl bg-sunken p-3">
            <p className="font-semibold">{CAMPUSES.humanities.label}</p>
            <p className="mt-0.5 text-ink-soft">
              분실 {humLost} · 습득 {humFound}
            </p>
          </div>
          <div className="rounded-xl bg-sunken p-3">
            <p className="font-semibold">{CAMPUSES.natural.label}</p>
            <p className="mt-0.5 text-ink-soft">
              분실 {natLost} · 습득 {natFound}
            </p>
          </div>
        </div>
      </section>

      <BetaToggle initialOpen={betaOpen} />

      <section className="card divide-y divide-line-soft">
        {menu.map((m) => (
          <Link
            key={m.href}
            href={m.href}
            className="flex items-center gap-3 px-5 py-4 transition hover:bg-sunken"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sunken text-ink-soft">
              <Icon name={m.icon} size={17} />
            </span>
            <span className="flex-1 font-semibold">{m.label}</span>
            {m.badge > 0 && (
              <span className="chip bg-brand text-white">{m.badge}</span>
            )}
            <Icon name="arrowRight" size={16} className="text-ink-faint" />
          </Link>
        ))}
      </section>
    </div>
  );
}
