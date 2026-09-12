import { createAdminClient } from "@/lib/supabase/admin";
import { getT } from "@/i18n/server";

async function count(admin, table, filter) {
  let q = admin.from(table).select("id", { count: "exact", head: true });
  if (filter) q = filter(q);
  const { count: c } = await q;
  return c || 0;
}

// 랜딩 숫자. "되찾음"은 채팅방의 전달 완료(deal_completed_at) 기준 —
// 예전 matches 테이블은 더 이상 쌓이지 않아서 세면 안 된다.
export default async function LandingStats() {
  const admin = createAdminClient();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  let completed = 0;
  let weekPosts = 0;
  let openPosts = 0;
  try {
    [completed, weekPosts, openPosts] = await Promise.all([
      count(admin, "chat_rooms", (q) => q.not("deal_completed_at", "is", null)),
      Promise.all([
        count(admin, "lost_posts", (q) => q.gte("created_at", weekAgo)),
        count(admin, "found_posts", (q) => q.gte("created_at", weekAgo)),
      ]).then(([a, b]) => a + b),
      Promise.all([
        count(admin, "lost_posts", (q) => q.eq("status", "찾는 중")),
        count(admin, "found_posts", (q) => q.eq("status", "보관 중")),
      ]).then(([a, b]) => a + b),
    ]);
  } catch {
    return null;
  }

  if (completed === 0 && openPosts === 0 && weekPosts === 0) return null;

  const t = await getT();
  const items = [
    { n: completed, label: t("landing.stat.found") },
    { n: weekPosts, label: t("landing.stat.week") },
    { n: openPosts, label: t("landing.stat.open") },
  ];

  return (
    <section className="grid grid-cols-3 divide-x divide-line">
      {items.map((it) => (
        <div key={it.label} className="px-2 text-center">
          <p className="num text-[28px] font-extrabold leading-none text-brand">
            {it.n}
          </p>
          <p className="mt-1.5 text-xs text-ink-faint">{it.label}</p>
        </div>
      ))}
    </section>
  );
}
