import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { getPost } from "@/lib/posts";
import { KIND_CONFIG } from "@/lib/constants";
import { locationDisplay } from "@/lib/campus";
import { formatDateTime } from "@/lib/format";
import { getT } from "@/i18n/server";
import TimeAgo from "./TimeAgo";
import StatusBadge from "./StatusBadge";
import KindTag from "./KindTag";
import MannerScore from "./MannerScore";
import DeletePostButton from "./DeletePostButton";
import MatchSuggestions from "./MatchSuggestions";
import OpenChatButton from "./OpenChatButton";
import ReportButton from "./ReportButton";
import Comments from "./Comments";
import PostImages from "./PostImages";
import Icon from "./Icon";

export default async function PostDetail({ kind, id }) {
  const cfg = KIND_CONFIG[kind];
  const { user } = await requireUser();
  const t = await getT();
  const kindItem = t(kind === "lost" ? "kind.lostItem" : "kind.foundItem");
  const supabase = await createClient();

  const post = await getPost(supabase, kind, id);
  if (!post) notFound();
  const isOwner = post.user_id === user.id;

  // 조회수 증가 — 1인 1회(post_views PK). 작성자 본인도 1로 카운트.
  let viewCount = post.view_count ?? 0;
  try {
    const { data } = await supabase.rpc("bump_view", {
      p_kind: kind,
      p_id: Number(id),
    });
    if (typeof data === "number") viewCount = data;
  } catch {
    /* bump_view 함수가 아직 없으면 무시 */
  }

  const images = Array.isArray(post.image_urls)
    ? post.image_urls
    : post.image_url
      ? [post.image_url]
      : [];

  return (
    <article className="space-y-5">
      <Link
        href={kind === "lost" ? "/?tab=lost" : "/"}
        className="inline-flex items-center gap-1 text-[13px] text-ink-faint transition hover:text-ink"
      >
        <Icon name="back" size={14} /> {t("detail.backList", { kind: kindItem })}
      </Link>

      {images.length > 0 && <PostImages images={images} />}

      <div className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <KindTag kind={kind} />
          <StatusBadge status={post.status} />
        </div>
        <h1 className="mt-2 break-words text-[22px] font-extrabold leading-snug">
          {post.title}
        </h1>

        <div className="num mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-faint">
          <span className="font-semibold text-ink-soft">{t(`cat.${post.category}`)}</span>
          <span aria-hidden>·</span>
          {post.campus && (
            <>
              <span>{t(`campus.${post.campus}`)}</span>
              <span aria-hidden>·</span>
            </>
          )}
          <TimeAgo value={post[cfg.dateField] || post.created_at} />
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1">
            <Icon name="eye" size={12} /> {viewCount}
          </span>
        </div>

        {/* 장소 · 시각 — 세부 위치는 만나서 찾을 때 제일 중요한 정보라 따로 강조 */}
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-sunken px-3.5 py-2.5 text-[13px]">
          <dt className="flex items-center gap-1 text-ink-faint">
            <Icon name="pin" size={12} /> {t("detail.place")}
          </dt>
          <dd className="min-w-0 break-words">
            <span className="font-semibold">
              {locationDisplay(post.campus, post.location)}
            </span>
            {post.location_detail && (
              <span className="text-ink-soft"> · {post.location_detail}</span>
            )}
          </dd>
          <dt className="flex items-center gap-1 text-ink-faint">
            <Icon name="clock" size={12} /> {t(kind === "lost" ? "form.lostAt" : "form.foundAt")}
          </dt>
          <dd className="num min-w-0">{formatDateTime(post[cfg.dateField])}</dd>
        </dl>

        <p className="mt-4 whitespace-pre-wrap break-words text-[15px] leading-[1.7]">
          {post.description}
        </p>

        <div className="mt-5 flex items-center gap-2 border-t border-line-soft pt-4 text-sm">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-tint text-xs font-bold text-brand-deep">
            {post.author?.nickname?.[0] || "?"}
          </span>
          <span className="font-medium text-ink-soft">
            {post.author?.nickname || "알 수 없음"}
          </span>
          {post.author?.trust_score != null && (
            <>
              <span className="text-ink-faint" aria-hidden>
                ·
              </span>
              <MannerScore score={post.author.trust_score} />
            </>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {isOwner ? (
            <>
              <Link
                href={`/${kind}/${id}/edit`}
                className="btn btn-ghost px-4 py-2.5 text-sm"
              >
                {t("detail.edit")}
              </Link>
              <DeletePostButton kind={kind} id={id} />
            </>
          ) : (
            <>
              <OpenChatButton
                postKind={kind}
                postId={id}
                label={t("detail.chat")}
              />
              <ReportButton
                targetType={kind === "lost" ? "lost_post" : "found_post"}
                targetId={id}
              />
            </>
          )}
        </div>
      </div>

      <MatchSuggestions target={post} kind={kind} canMatch={isOwner} />
      <Comments postType={kind} postId={id} viewerId={user.id} />
    </article>
  );
}
