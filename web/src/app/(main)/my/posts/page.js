import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listMyPostsAll } from "@/lib/posts";
import { KIND_CONFIG } from "@/lib/constants";
import { campusLabel } from "@/lib/campus";
import { timeAgo } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import KindTag from "@/components/KindTag";
import MyPostStatusControl from "@/components/MyPostStatusControl";
import Icon from "@/components/Icon";

export const metadata = { title: "내 게시글 · 명지 분실물 센터" };

const TABS = [
  ["all", "전체"],
  ["lost", "분실"],
  ["found", "습득"],
];

export default async function MyPostsPage({ searchParams }) {
  const { user } = await requireUser();
  const supabase = await createClient();
  const sp = await searchParams;
  const tab = ["lost", "found"].includes(sp.tab) ? sp.tab : "all";

  const all = await listMyPostsAll(supabase, user.id);
  const posts = tab === "all" ? all : all.filter((p) => p.kind === tab);

  return (
    <div>
      <div className="flex items-center gap-2">
        <Link
          href="/my"
          className="grid h-8 w-8 place-items-center rounded-full text-ink-soft transition hover:bg-sunken"
        >
          <Icon name="back" size={17} />
        </Link>
        <h1 className="text-xl font-extrabold">내 게시글</h1>
      </div>

      <div className="mt-3 flex gap-1 rounded-lg bg-sunken p-1">
        {TABS.map(([key, label]) => (
          <Link
            key={key}
            href={key === "all" ? "/my/posts" : `/my/posts?tab=${key}`}
            className={`flex-1 rounded-md px-3 py-1.5 text-center text-sm font-semibold transition ${
              tab === key ? "bg-surface text-ink shadow-sm" : "text-ink-soft"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        {posts.length === 0 ? (
          <p className="card-dashed p-10 text-center text-sm text-ink-faint">
            등록한 게시글이 없어요.
          </p>
        ) : (
          posts.map((p) => {
            return (
              <div key={`${p.kind}-${p.id}`} className="card p-3.5">
                <div className="flex items-start gap-2">
                  <KindTag kind={p.kind} className="mt-0.5" />
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
                    {campusLabel(p.campus)} · {p.location} ·{" "}
                    {timeAgo(p[KIND_CONFIG[p.kind].dateField] || p.created_at)}
                  </p>
                  <MyPostStatusControl
                    kind={p.kind}
                    id={p.id}
                    status={p.status}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
