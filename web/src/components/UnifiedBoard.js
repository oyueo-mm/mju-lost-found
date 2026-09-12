import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listPosts } from "@/lib/posts";
import { unreadMessageCount } from "@/lib/alerts";
import { KIND_CONFIG } from "@/lib/constants";
import { getT } from "@/i18n/server";
import PostTile from "./PostTile";
import CampusTabs from "./CampusTabs";
import BoardFilters from "./BoardFilters";
import TimeAgo from "./TimeAgo";
import Icon from "./Icon";

const TABS = [
  ["found", "board.tabFound"],
  ["lost", "board.tabLost"],
];

const PAGE_SIZE = 24; // 2열·3열 모두 딱 떨어지는 수

function tabHref(tab, { campus, q, category, sort, page }) {
  const sp = new URLSearchParams();
  if (tab !== "found") sp.set("tab", tab);
  if (campus) sp.set("campus", campus);
  if (q) sp.set("q", q);
  if (category) sp.set("category", category);
  if (sort && sort !== "newest") sp.set("sort", sort);
  if (page && page > 1) sp.set("page", String(page));
  const qs = sp.toString();
  return qs ? `/?${qs}` : "/";
}

export default async function UnifiedBoard({
  campus,
  tab = "found",
  q = "",
  category = "",
  sort = "newest",
  page = 1,
}) {
  const { user, profile, supabase } = await requireUser();
  const t = await getT();
  const kind = KIND_CONFIG[tab] ? tab : "found";
  const cfg = KIND_CONFIG[kind];
  const campusName = t(`campus.${campus}`);
  const kindItem = t(kind === "found" ? "kind.foundItem" : "kind.lostItem");

  let posts = [];
  let hasMore = false;
  let loadError = null;
  let myLost = [];
  let chatUnread = 0;
  try {
    const [list, mine, unread] = await Promise.all([
      // 한 장 더 받아서 다음 페이지 유무 판단
      listPosts(supabase, kind, {
        campus,
        q,
        category,
        sort,
        limit: PAGE_SIZE + 1,
        offset: (page - 1) * PAGE_SIZE,
      }),
      supabase
        .from("lost_posts")
        .select("id, title, category, created_at, lost_at")
        .eq("user_id", user.id)
        .eq("status", "찾는 중")
        .order("created_at", { ascending: false })
        .limit(4),
      unreadMessageCount(supabase, user.id),
    ]);
    posts = list.slice(0, PAGE_SIZE);
    hasMore = list.length > PAGE_SIZE;
    myLost = mine.data || [];
    chatUnread = unread;
  } catch {
    loadError = t("board.loadError");
  }

  const filtered = Boolean(q || category);
  // 캠퍼스 전환 시 탭·필터는 유지 (CampusTabs 가 campus= 만 덧붙임)
  const campusBase = tabHref(kind, { campus: "", q, category, sort });

  return (
    <div>
      {/* ── 개인 홈 헤더 ─────────────────────────── */}
      <header>
        <p className="num text-[13px] font-medium text-ink-faint">{campusName}</p>
        <h1 className="mt-1 truncate text-[20px] font-extrabold leading-tight">
          {t("board.greeting", { name: profile?.nickname || "" })}
        </h1>
      </header>

      {chatUnread > 0 && (
        <Link
          href="/chat"
          className="num mt-3 inline-flex items-center gap-1 rounded-md bg-brand-tint px-2.5 py-1 text-xs font-semibold text-brand-deep transition hover:bg-brand-soft/50"
        >
          {t("board.unreadChat", { n: chatUnread })}
          <Icon name="arrowRight" size={12} />
        </Link>
      )}

      {/* ── 내 분실물 ───────────────────────────── */}
      <section className="mt-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">{t("board.myLost")}</h2>
          {myLost.length > 0 && (
            <Link
              href="/my/posts?tab=lost"
              className="text-xs text-ink-faint transition hover:text-ink"
            >
              {t("board.all")}
            </Link>
          )}
        </div>

        {myLost.length > 0 ? (
          <div className="mt-2 card divide-y divide-line-soft overflow-hidden">
            {myLost.slice(0, 3).map((p) => (
              <Link
                key={p.id}
                href={`/lost/${p.id}`}
                className="flex items-center gap-3 px-4 py-3 transition hover:bg-sunken"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{p.title}</p>
                  <p className="num mt-0.5 text-xs text-ink-faint">
                    {t(`cat.${p.category}`)}
                    <span aria-hidden> · </span>
                    <TimeAgo value={p.lost_at || p.created_at} />
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-brand">
                  {t("board.matchCheck")}
                  <Icon name="arrowRight" size={13} />
                </span>
              </Link>
            ))}
            <Link
              href="/lost/new"
              className="flex items-center gap-2 px-4 py-3 text-sm text-ink-soft transition hover:bg-sunken hover:text-brand"
            >
              <Icon name="plus" size={14} />
              {t("board.addLost")}
            </Link>
          </div>
        ) : (
          <Link
            href="/lost/new"
            className="mt-2 flex items-center gap-3 rounded-[var(--radius)] border border-line bg-surface px-4 py-3.5 transition hover:border-brand-soft"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-tint text-brand">
              <Icon name="search" size={17} strokeWidth={2} />
            </span>
            <span className="min-w-0 flex-1 text-sm">
              <b className="font-semibold">{t("board.lostPrompt")}</b>
              <span className="block text-xs text-ink-faint">{t("board.lostPromptSub")}</span>
            </span>
            <Icon name="arrowRight" size={14} className="shrink-0 text-ink-faint" />
          </Link>
        )}
      </section>

      {/* ── 게시판 ──────────────────────────────── */}
      <section className="mt-7 border-t border-line-soft pt-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold">
            {t("board.title")}
            <span className="num ml-1.5 font-semibold text-ink-faint">
              {posts.length}
            </span>
          </h2>
          <div className="flex shrink-0 items-center gap-1.5">
            <Link
              href={`/search?campus=${campus}`}
              className="grid h-8 w-8 place-items-center rounded-md text-ink-soft transition hover:bg-sunken"
              aria-label={t("board.aiSearch")}
              title={t("board.aiSearch")}
            >
              <Icon name="sparkle" size={18} />
            </Link>
            <Link
              href={`/${kind}/new?campus=${campus}`}
              className="btn btn-primary gap-1 px-3 py-1.5 text-[13px]"
            >
              <Icon name="plus" size={14} />
              {t(kind === "found" ? "board.registerFound" : "board.registerLost")}
            </Link>
          </div>
        </div>

        {/* 습득물 / 분실물 전환 */}
        <div className="mt-3 flex gap-1 rounded-lg bg-sunken p-1">
          {TABS.map(([key, labelKey]) => (
            <Link
              key={key}
              href={tabHref(key, { campus, q, category, sort })}
              className={`flex-1 rounded-md px-3 py-1.5 text-center text-sm font-semibold transition ${
                kind === key
                  ? "bg-surface text-ink shadow-sm"
                  : "text-ink-soft hover:text-ink"
              }`}
            >
              {t(labelKey)}
            </Link>
          ))}
        </div>

        <div className="mt-2">
          <CampusTabs current={campus} basePath={campusBase} />
        </div>

        <div className="mt-3">
          <BoardFilters q={q} category={category} sort={sort} />
        </div>

        <div className="mt-4">
          {loadError ? (
            <p className="card p-8 text-center text-sm text-brand-deep">
              {loadError}
            </p>
          ) : posts.length === 0 ? (
            <div className="card-dashed p-10 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-sunken text-ink-faint">
                <Icon name={cfg.icon} size={22} strokeWidth={1.7} />
              </div>
              <p className="mt-3 text-sm text-ink-faint">
                {filtered
                  ? t("board.emptyFiltered")
                  : t("board.empty", { campus: campusName, kind: kindItem })}
              </p>
              {!filtered && (
                <Link
                  href={`/${kind}/new?campus=${campus}`}
                  className="btn btn-primary mt-4 px-4 py-2 text-sm"
                >
                  {t(kind === "found" ? "board.firstFound" : "board.firstLost")}
                </Link>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3">
                {posts.map((p) => (
                  <PostTile key={p.id} post={p} kind={kind} />
                ))}
              </div>
              {(page > 1 || hasMore) && (
                <nav className="mt-6 flex items-center justify-between gap-2">
                  {page > 1 ? (
                    <Link
                      href={tabHref(kind, { campus, q, category, sort, page: page - 1 })}
                      className="btn btn-ghost gap-1 px-3 py-2 text-sm"
                    >
                      <Icon name="back" size={14} />
                      {t("board.prev")}
                    </Link>
                  ) : (
                    <span />
                  )}
                  <span className="num text-xs text-ink-faint">{page}</span>
                  {hasMore ? (
                    <Link
                      href={tabHref(kind, { campus, q, category, sort, page: page + 1 })}
                      className="btn btn-ghost gap-1 px-3 py-2 text-sm"
                    >
                      {t("board.next")}
                      <Icon name="arrowRight" size={14} />
                    </Link>
                  ) : (
                    <span />
                  )}
                </nav>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
